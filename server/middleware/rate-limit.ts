import { createMiddleware } from 'hono/factory'
import { lt, sql } from 'drizzle-orm'
import { createDb } from '../db'
import { rateLimits } from '../db/schema'
import { rateLimitIpKey } from './client-ip'

type Rule = { scope: string; limit: number; windowMs: number }

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

// Day-one abuse posture (REWRITE_PLAN.md section 13, decision 2): fixed-window
// counters per scope+key in the rate_limits table. Plain SQLite, no
// Cloudflare-only primitives - the WAF is hardening on top, not the mechanism.
//
// This is now the ONLY rate limiting in the app, and that is easy to get wrong:
// better-auth's own limiter is disabled (authOptions), and the magic-link plugin
// ships a rate-limit rule that therefore NEVER FIRES. Anyone reading the plugin
// source would reasonably assume magic links are covered. They are not. They are
// covered here, by hand, or not at all.
const SIGN_IN: Rule = { scope: 'sign-in', limit: 10, windowMs: 10 * MINUTE }
const AUTH_DEFAULT: Rule = { scope: 'auth', limit: 30, windowMs: 10 * MINUTE }

// Requesting a magic link is the single most abusable endpoint in a passwordless
// app: it is unauthenticated, it sends mail on demand, and the mail it sends
// grants a session. THREE distinct abuses, and no single key stops all three -
// hence three buckets, all charged on every send, any one of which can 429.
//
//   1. Drain the mail quota (Resend free tier is 100/day, and the quota is
//      GLOBAL) -> keyed by nothing at all. A per-IP cap cannot do this job: at
//      N/day per IP, a handful of IPs still exhausts the provider. This is the
//      only bucket that actually guards the quota.
//   2. Spray links at many addresses from one host -> keyed by IP.
//   3. Bomb ONE victim's inbox, or farm tokens for one account, from rotating
//      IPs -> keyed by EMAIL. An IP-keyed limiter walks straight around this
//      (every request looks like a first-time caller), which is why the
//      per-address bucket exists and why it is the one that must not be relaxed.
//
// The GLOBAL bucket is the availability trade-off in this file, so it is written
// down rather than discovered later: if it is ever drained, NOBODY can recover an
// account until the window rolls. That is not worse than the mail quota running
// out - the effect is identical - but it fails earlier and on purpose, and the
// IP/address caps in front of it are what make draining it expensive. It is also
// charged LAST (see the middleware), so requests the other two already refused
// never spend it: it tracks mail actually sent, not attempts.
//
// Raise MAGIC_LINK_SEND_GLOBAL when the mail provider's quota rises (e.g. SES).
// It is the one number tied to the provider.
const MAGIC_LINK_SEND_GLOBAL: Rule = {
  scope: 'magic-send-global',
  limit: 90, // headroom under Resend's free 100/day
  windowMs: DAY,
}
const MAGIC_LINK_SEND_IP: Rule = {
  scope: 'magic-send-ip',
  limit: 10,
  windowMs: 10 * MINUTE,
}
const MAGIC_LINK_SEND_EMAIL: Rule = {
  scope: 'magic-send-email',
  limit: 5,
  windowMs: 60 * MINUTE,
}
// Redeeming a link. The token is 32 random chars, so this is not a guessing
// oracle in any practical sense - the budget is there to stop a flood, not a
// brute force.
const MAGIC_LINK_VERIFY: Rule = {
  scope: 'magic-verify',
  limit: 10,
  windowMs: 10 * MINUTE,
}
// Irreversible, and now gated on session freshness rather than a password.
const DELETE_USER: Rule = { scope: 'delete-user', limit: 5, windowMs: 10 * MINUTE }

// Longest window; rows older than this are dead and get swept.
const MAX_WINDOW_MS = DAY

const MAGIC_LINK_SEND_PATH = '/api/auth/sign-in/magic-link'

// The passkey SIGN-IN ceremony. Anonymous by definition, and now the primary
// way into the app, so it gets the sign-in budget rather than the generic one.
// Note these do not live under /sign-in/* - the plugin mounts them under
// /passkey/*, so a path prefix alone would miss them and quietly leave the main
// front door on the loosest bucket in the app.
const PASSKEY_SIGN_IN_PATHS = new Set([
  '/api/auth/passkey/generate-authenticate-options',
  '/api/auth/passkey/verify-authentication',
])

function ruleFor(path: string): Rule {
  if (path === MAGIC_LINK_SEND_PATH) return MAGIC_LINK_SEND_IP
  if (path === '/api/auth/magic-link/verify') return MAGIC_LINK_VERIFY
  if (path === '/api/auth/delete-user') return DELETE_USER
  if (PASSKEY_SIGN_IN_PATHS.has(path)) return SIGN_IN
  // Fail-closed default for anything SIGN-IN SHAPED. This is not here for the
  // dead password endpoints - it is here so that a sign-in route added later
  // lands on the tight bucket automatically rather than silently inheriting the
  // loosest one in the app. That it also meters /sign-in/email and
  // /sign-up/email, which now 400 with no emailAndPassword config, is incidental:
  // a dead endpoint is still a free request if nothing counts it. (The password
  // era is over; do not read this branch as evidence of it.)
  if (path.startsWith('/api/auth/sign-in') || path.startsWith('/api/auth/sign-up')) {
    return SIGN_IN
  }
  return AUTH_DEFAULT
}

// The per-email bucket key. The normalization here must match EXACTLY the
// identity better-auth resolves - no more, no less. Both halves of that are
// load-bearing, in opposite directions:
//
// - LOWERCASE, because better-auth lowercases on create and lookup, so
//   Victim@x.com and victim@x.com are ONE account. Keying the raw input would
//   hand an attacker unlimited buckets for one inbox just by varying case.
//
// - DO NOT TRIM, even though trimming looks like more careful normalization.
//   better-auth validates the body with z.email() and does NOT trim, so
//   "victim@x.com " (trailing space) is REJECTED and no mail is ever sent.
//   Trimming here would fold that rejected string onto the victim's real bucket,
//   letting an attacker burn the victim's 5/hour recovery budget from rotating
//   IPs without sending a single email - a targeted lockout of the passwordless
//   root of trust. Untrimmed, the junk address gets its own junk bucket, which
//   is exactly where the cost belongs. (Found by review, not by me.)
//
// - HMAC, not a bare hash. Without it, rate_limits.key becomes a list of every
//   address that ever requested a link, and a plain SHA-256 of an email address
//   is trivially reversible with a dictionary - it is a lookup key, not a
//   secret. The pepper is BETTER_AUTH_SECRET: real secret material (a Worker
//   secret), NOT BETTER_AUTH_URL or any other public/low-entropy value, and it
//   is never logged.
//
// - DOMAIN-SEPARATED. BETTER_AUTH_SECRET is also better-auth's own signing key,
//   so the message is prefixed to make this HMAC unmistakably a different
//   protocol from anything the library signs with the same key. One key, two
//   uses, is the shape cross-protocol confusion needs; the prefix removes it.
const EMAIL_BUCKET_DOMAIN = 'grampacker:magic-send-email:v1:'

async function emailBucketKey(secret: string, email: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${EMAIL_BUCKET_DOMAIN}${email.toLowerCase()}`),
  )
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

// Reads the email a magic-link request is for, so it can be charged to that
// address's bucket as well as the caller's IP.
//
// READ A CLONE. This is not defensive style, it is required: the route handler
// passes the RAW request straight to better-auth (`createAuth(...).handler(
// c.req.raw)` in server/index.ts), which bypasses Hono's body cache entirely.
// Calling `c.req.json()` here would populate that cache by consuming
// `raw`'s body stream, and better-auth would then throw "Body has already been
// used" - a 500 on the send endpoint, i.e. nobody can sign in. A clone has its
// own stream, so the original arrives untouched.
//
// A body we cannot read gets a stable key rather than a free pass: a malformed
// send is still a request, and letting it skip the bucket would be a bypass.
async function magicLinkEmail(c: { req: { raw: Request } }): Promise<string> {
  try {
    const body = (await c.req.raw.clone().json()) as { email?: unknown }
    return typeof body.email === 'string' ? body.email : 'malformed'
  } catch {
    return 'malformed'
  }
}

// GET is NOT read-only in better-auth: the passkey plugin's
// /passkey/generate-*-options endpoints are GETs that write a challenge
// row to the verification table (generate-authenticate-options without
// even a session), and magic-link/verify is a GET that CREATES A USER AND A
// SESSION. So the limiter is fail-closed across ALL methods, with an explicit
// allowlist of pure-read GETs that clients hit routinely and that must never
// 429 (the session poll fires after every auth mutation). A new endpoint is
// limited until it earns a spot here.
const READ_ONLY_GET_PATHS = new Set([
  '/api/auth/get-session',
  '/api/auth/passkey/list-user-passkeys',
])

// Charge one request to one bucket. Returns the 429 response if the bucket is
// spent, or null to continue. Split out because a magic-link send charges TWO
// buckets (the caller's IP and the target address) and either can reject.
async function consume(
  db: ReturnType<typeof createDb>,
  rule: Rule,
  keySuffix: string,
  now: number,
): Promise<Response | null> {
  const key = `${rule.scope}:${keySuffix}`
  const cutoff = now - rule.windowMs

  // One atomic upsert: no read-modify-write race between concurrent
  // requests. Rejected attempts count too, so a flood keeps itself
  // locked out - but the fixed window still expires at
  // windowStart + windowMs regardless of attempts.
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} <= ${cutoff} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${rateLimits.windowStart} <= ${cutoff} then ${now} else ${rateLimits.windowStart} end`,
      },
    })
    .returning()
  if (!row) {
    throw new Error('rate limit upsert returned no row')
  }

  // Deterministic sweep: whenever any bucket starts a new window
  // (count reset to 1), clear rows whose window started more than
  // MAX_WINDOW_MS ago - those are expired for every scope. Bound:
  // a stale row lives at most MAX_WINDOW_MS past its window start,
  // so the table stays proportional to buckets touched in the last
  // day. Deliberately no window_start index: the sweep is rare and
  // the table small, while an index would tax every upsert.
  if (row.count === 1) {
    await db.delete(rateLimits).where(lt(rateLimits.windowStart, now - MAX_WINDOW_MS))
  }

  if (row.count > rule.limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((row.windowStart + rule.windowMs - now) / 1000),
    )
    return Response.json({ error: 'Too many requests' }, {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSeconds) },
    })
  }
  return null
}

// Limits auth requests per client IP, every method except allowlisted
// read-only GETs. CF-Connecting-IP is set by Cloudflare's edge and
// cannot be spoofed through it; it is absent in local dev and tests
// unless injected, where everything shares one bucket ('local'). The
// Node deployment target must map its trusted client-IP source to the
// same header.
export const authRateLimit = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    if (
      (c.req.method === 'GET' || c.req.method === 'HEAD') &&
      READ_ONLY_GET_PATHS.has(c.req.path)
    ) {
      return next()
    }

    const rule = ruleFor(c.req.path)
    const rawIp = c.req.header('cf-connecting-ip')
    // IPv6 is bucketed by /64, not by exact address - see client-ip.ts.
    // Keying the raw address would let any IPv6 client rotate through its
    // own prefix and mint unlimited budget.
    const ip = rawIp === undefined ? 'local' : rateLimitIpKey(rawIp)
    const now = Date.now()
    const db = createDb(c.env.DB)

    const byIp = await consume(db, rule, ip, now)
    if (byIp) return byIp

    // A magic-link send is charged to three buckets, and the ORDER is deliberate:
    // narrowest and cheapest first, the shared quota last.
    //
    //   IP -> ADDRESS -> GLOBAL
    //
    // Charging GLOBAL last is what stops an attacker draining everyone's recovery
    // path: a flood is already refused by the IP or address cap, and a refused
    // request never reaches the global bucket, so it cannot spend mail budget it
    // was never going to use. The global count therefore tracks mail actually
    // sent, not attempts made. Reverse this order and a single host could 429 the
    // whole app's recovery for a day.
    if (c.req.path === MAGIC_LINK_SEND_PATH) {
      const byEmail = await consume(
        db,
        MAGIC_LINK_SEND_EMAIL,
        await emailBucketKey(c.env.BETTER_AUTH_SECRET, await magicLinkEmail(c)),
        now,
      )
      if (byEmail) return byEmail

      const byQuota = await consume(db, MAGIC_LINK_SEND_GLOBAL, 'all', now)
      if (byQuota) return byQuota
    }

    return next()
  },
)
