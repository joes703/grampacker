import { createMiddleware } from 'hono/factory'
import { eq, lt, sql } from 'drizzle-orm'
import { createDb, type Db } from '../db'
import { rateLimits, verification } from '../db/schema'
import { clientIpFromForwardedFor, rateLimitIpKey } from './client-ip'
import type { AppEnv } from '../env'

type Rule = { scope: string; limit: number; windowMs: number }

// The result of charging (or peeking at) a bucket. `retryAfterSeconds` is only
// meaningful when the bucket is spent, so it lives on that branch of the union
// rather than being an optional field callers have to remember to check.
export type RateVerdict =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number }

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

// Fixed-window counters per scope+key in the rate_limits table, for semantic
// budgets only (things only the app can see). Volumetric limits belong at the
// edge (SECURITY.md, "Abuse and rate limiting").
//
// This is now the ONLY rate limiting in the app, and that is easy to get wrong:
// better-auth's own limiter is disabled (authOptions), and the magic-link plugin
// ships a rate-limit rule that therefore NEVER FIRES. Anyone reading the plugin
// source would reasonably assume magic links are covered. They are not. They are
// covered here, by hand, or not at all.
const SIGN_IN: Rule = { scope: 'sign-in', limit: 10, windowMs: 10 * MINUTE }
const AUTH_DEFAULT: Rule = { scope: 'auth', limit: 30, windowMs: 10 * MINUTE }

// The passkey SIGN-IN ceremony, on its own budget rather than SIGN_IN's.
//
// It used to share SIGN_IN (10 per 10 minutes) on the reasoning that the front
// door deserves the tight bucket. That reasoning imported a PASSWORD threat
// model into a flow that has no password in it, and nobody did the arithmetic:
//
//   - One ceremony costs TWO requests, not one. The client calls
//     generate-authenticate-options, the browser prompts, then it calls
//     verify-authentication. Both are metered, so 10 requests was FIVE
//     attempts.
//   - A ceremony the user ABANDONS still costs one. Cancelling the browser's
//     passkey picker - or picking the wrong credential and backing out - burns
//     budget without ever reaching verification.
//
// So the real budget was roughly five to ten fumbles before a ten-minute
// lockout, and a user with several passkeys hits that just by choosing wrong a
// few times. That is exactly what happened to the app owner on 2026-09-12, on
// production, and it is a bad trade: we were rationing the one action a
// legitimate user has a genuine reason to repeat.
//
// What this bucket actually defends, now that it is named honestly:
//
//   - generate-authenticate-options WRITES a challenge row to `verification`
//     and takes no session, so unmetered it is an anonymous write amplifier.
//     That is the real cost, and it is what the limit is sized against.
//   - verify-authentication burns a signature verification on failure.
//
// What it does NOT defend, and must not be sized as if it did: credential
// guessing. A WebAuthn assertion requires the private key in the
// authenticator. There is no secret here to brute force, so the
// few-attempts-then-lockout shape that protects a password buys nothing and
// costs the owner their own front door.
//
// 30 per 5 minutes = 15 full ceremonies. Stated precisely, because "looser" is
// exactly the word that should not be left vague in a security control:
//
//   - Sustained rate rises SIX times (30/5min vs 10/10min).
//   - Worst-case BURST rises about three times. Fixed windows have a boundary:
//     a bucket's whole limit immediately before expiry plus a whole limit after
//     is ~59 accepted requests close together, against ~19 before. Still well
//     under the ~119 that 60-per-10-minutes would allow - which is why the
//     window shortened rather than the ceiling doubling.
//   - It halves the MAXIMUM REMAINING WINDOW after a rejection (up to five
//     minutes rather than up to ten), not the wait itself: the window started
//     on the bucket's first request, so a rejected caller may be seconds from
//     the reset or a full window away from it.
//
// The cost this rate actually buys is bounded elsewhere, not hand-waved: the
// `verification` rows these challenges write are swept in charge() below,
// because no passkey flow sweeps them. Read that comment before raising this.
const PASSKEY_SIGN_IN: Rule = {
  scope: 'passkey-sign-in',
  limit: 30,
  windowMs: 5 * MINUTE,
}

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
// IP/address caps in front of it are what make draining it expensive.
//
// WHERE IT IS CHARGED, AND WHY NOT HERE. The global bucket is the ONLY one this
// middleware does not charge. It is charged inside better-auth's `sendMagicLink`
// callback (server/auth.ts) instead, immediately before the mail goes out.
//
// It used to be charged here, and that was a real hole: this middleware runs
// BEFORE better-auth parses the body, so it cannot tell a deliverable address
// from junk. better-auth validates with z.email() and 400s a bad one - but the
// slot was already spent. ~90 requests carrying garbage addresses, from rotating
// IPs, therefore drained a day of the ONLY recovery path in a passwordless app
// while sending zero mail. Charging in the callback means better-auth has already
// validated the address (z.email(); case is NOT folded), so nothing that cannot
// become an email can spend the shared quota. (Found by review, 2026-07-12.)
//
// What the counter therefore means, precisely: VALIDATED SEND ATTEMPTS. It is
// charged just before email.send, not after, so a provider failure still spends a
// slot. That is deliberate - reserve-then-refund would leak a slot forever
// whenever an isolate dies mid-send, which is a worse failure than losing one of
// 90 slots to a rare Resend 5xx. Do not write "mail actually sent" here again.
//
// The middleware still PEEKS at this bucket (without charging it) so an already
// spent quota is refused up front - see the middleware for why that matters.
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

// The two requests one passkey sign-in ceremony makes. Note they do not live
// under /sign-in/* - the plugin mounts them under /passkey/*, so a path prefix
// alone would miss them and quietly leave the main front door on the loosest
// bucket in the app. Both are metered: exempting the first would make an
// anonymous endpoint that writes a DB row free to call.
const PASSKEY_SIGN_IN_PATHS = new Set([
  '/api/auth/passkey/generate-authenticate-options',
  '/api/auth/passkey/verify-authentication',
])

function ruleFor(path: string): Rule {
  if (path === MAGIC_LINK_SEND_PATH) return MAGIC_LINK_SEND_IP
  if (path === '/api/auth/magic-link/verify') return MAGIC_LINK_VERIFY
  if (path === '/api/auth/delete-user') return DELETE_USER
  if (PASSKEY_SIGN_IN_PATHS.has(path)) return PASSKEY_SIGN_IN
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
//   secret. The pepper is BETTER_AUTH_SECRET: real secret material, NOT
//   BETTER_AUTH_URL or any other public/low-entropy value, and it
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

function retryAfterSeconds(windowStart: number, rule: Rule, now: number): number {
  return Math.max(1, Math.ceil((windowStart + rule.windowMs - now) / 1000))
}

// Charge one request to one bucket and report the verdict. The transport-neutral
// core: the middleware wraps it into a 429 Response, while server/auth.ts needs
// the verdict itself (it is inside better-auth, where the answer has to be an
// APIError, not a Response).
//
// Synchronous on purpose: no other request can run between the statements
// below. The charge itself does not depend on that, though.
function charge(db: Db, rule: Rule, keySuffix: string, now: number): RateVerdict {
  const key = `${rule.scope}:${keySuffix}`
  const cutoff = now - rule.windowMs

  // ONE statement decides the count and the window together, so overlapping
  // requests cannot lose an increment, both reset the same expired window, or
  // reset a window another request just started. A read, then a write, could
  // do all three. Rejected attempts count too, so a flood keeps itself locked
  // out - but the fixed window still expires at windowStart + windowMs
  // regardless of attempts.
  //
  // Callers read `now` just before charging, but two requests' readings can
  // still arrive out of order. A charge carrying an older `now` than the one
  // that started the current window counts in that window: the
  // `windowStart <= cutoff` test never moves a window backwards.
  const row = db
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
    .get()
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
    db.delete(rateLimits).where(lt(rateLimits.windowStart, now - MAX_WINDOW_MS)).run()
    // ...and expired `verification` rows, on the same trigger. better-auth
    // sweeps them only as a side effect of findVerificationValue, which
    // several unrelated routes call (magic-link verify, the reset-password
    // callback, the OAuth callback's state check, among others). Passkey
    // ceremonies consume through consumeVerificationValue, which deletes only
    // rows with the consumed challenge's identifier. So an ABANDONED challenge
    // - the user who opens the passkey picker and cancels - leaves a row that
    // expires in five minutes and then lives until some unrelated request
    // happens to arrive. Cleanup must not depend on that traffic.
    //
    // That leak predates this sweep, but the passkey budget (30/5min, raised
    // from an effective 10/10min on 2026-09-12) raises its ceiling sixfold, to
    // ~8,640 rows/day/IP of anonymous GET traffic. Accelerating an unbounded
    // path without bounding it is not a trade worth making, so it is bounded
    // here rather than written down as accepted risk.
    //
    // Safe to delete early: a row past expiresAt is already dead. better-auth's
    // own consume treats expired rows as invalid - it deletes the row and
    // returns null - so removing them ahead of time changes no outcome. This
    // runs on the same rare trigger as the sweep above, so it costs one extra
    // statement per new window, not one per request.
    //
    // FAILS OPEN, and the asymmetry with the charge above is the whole point.
    // The charge must fail CLOSED - if it throws, the request dies rather than
    // passing unmetered, because a swallowed charge is a limiter bypass. This
    // is opportunistic garbage collection: the rows it misses are already
    // expired and therefore already inert, and the next bucket to roll a window
    // sweeps them instead. Letting a database error here turn into a failed
    // SIGN-IN would be trading the thing users need for the thing the table
    // needs.
    // (Caught by the sabotage suite: auth-error-logging.test.ts dooms every
    // non-limiter statement, and an unguarded sweep took the whole request down
    // with it.)
    try {
      db.delete(verification).where(lt(verification.expiresAt, new Date(now))).run()
    } catch {
      // Deliberately swallowed - see above. Not logged: this runs on the auth
      // hot path, and a failing database would otherwise write one entry per
      // new window through the incident budget, crowding out the failure that
      // actually matters.
    }
  }

  if (row.count > rule.limit) {
    return { ok: false, retryAfterSeconds: retryAfterSeconds(row.windowStart, rule, now) }
  }
  return { ok: true }
}

// Read a bucket WITHOUT charging it. Used only for the global mail quota, whose
// authoritative charge happens later (in sendMagicLink), and which therefore
// needs a way to be refused early.
//
// Racy by construction, and that is fine: it is an optimization, not the gate.
// Two callers can both peek "not spent" and both proceed; the atomic charge in
// the callback is what actually enforces the limit, so no extra mail escapes.
// A peek must never be the only thing standing between a request and a send.
function peek(db: Db, rule: Rule, keySuffix: string, now: number): RateVerdict {
  const row = db
    .select()
    .from(rateLimits)
    .where(eq(rateLimits.key, `${rule.scope}:${keySuffix}`))
    .get()

  // No row, or a window that has already rolled: the bucket is not spent.
  if (!row || row.windowStart <= now - rule.windowMs) return { ok: true }
  // `charge` refuses at count > limit, so a bucket holding `limit` is full: the
  // next charge would be the one that gets refused.
  if (row.count >= rule.limit) {
    return { ok: false, retryAfterSeconds: retryAfterSeconds(row.windowStart, rule, now) }
  }
  return { ok: true }
}

// Charge one validated magic-link send against the shared mail quota. Called
// from better-auth's sendMagicLink callback (server/auth.ts) - the first point
// in the request where the address is known to be real. See the block comment on
// MAGIC_LINK_SEND_GLOBAL for why it is not charged in the middleware.
export function chargeMagicLinkGlobalQuota(db: Db, now: number): RateVerdict {
  return charge(db, MAGIC_LINK_SEND_GLOBAL, 'all', now)
}

// Non-charging read of the same bucket, for the middleware's early refusal.
export function peekMagicLinkGlobalQuota(db: Db, now: number): RateVerdict {
  return peek(db, MAGIC_LINK_SEND_GLOBAL, 'all', now)
}

function tooManyRequests(verdict: { retryAfterSeconds: number }): Response {
  return Response.json({ error: 'Too many requests' }, {
    status: 429,
    headers: { 'Retry-After': String(verdict.retryAfterSeconds) },
  })
}

// Charge one request to one bucket. Returns the 429 response if the bucket is
// spent, or null to continue. Split out because a magic-link send charges TWO
// buckets (the caller's IP and the target address) and either can reject.
function consume(db: Db, rule: Rule, keySuffix: string, now: number): Response | null {
  const verdict = charge(db, rule, keySuffix, now)
  return verdict.ok ? null : tooManyRequests(verdict)
}

// Limits auth requests per client IP, every method except allowlisted
// read-only GETs. The client IP is the rightmost X-Forwarded-For entry, the
// address Caddy saw (client-ip.ts says why only that entry is trusted). It
// is absent in local dev and tests unless injected, where everything shares
// one bucket ('local').
export const authRateLimit = createMiddleware<{ Bindings: AppEnv }>(
  async (c, next) => {
    if (
      (c.req.method === 'GET' || c.req.method === 'HEAD') &&
      READ_ONLY_GET_PATHS.has(c.req.path)
    ) {
      return next()
    }

    const rule = ruleFor(c.req.path)
    const rawIp = clientIpFromForwardedFor(c.req.header('x-forwarded-for'))
    // IPv6 is bucketed by /64, not by exact address - see client-ip.ts.
    // Keying the raw address would let any IPv6 client rotate through its
    // own prefix and mint unlimited budget.
    const ip = rawIp === undefined ? 'local' : rateLimitIpKey(rawIp)
    const now = Date.now()
    const db = createDb(c.env.DB)

    const byIp = consume(db, rule, ip, now)
    if (byIp) return byIp

    // A magic-link send is metered against three buckets, and the ORDER is
    // deliberate: narrowest and cheapest first, the shared quota last.
    //
    //   IP -> ADDRESS -> GLOBAL
    //
    // Ordering GLOBAL last is what stops one attacker denying recovery to
    // everyone: a flood the IP or address cap already refused never reaches the
    // shared quota, so it cannot spend mail budget it was never going to use.
    // Reverse this and a single host could 429 the whole app's recovery for a day.
    //
    // Only the first two are CHARGED here. The global bucket is merely PEEKED at,
    // and charged later, in sendMagicLink, once better-auth has validated the
    // address (see MAGIC_LINK_SEND_GLOBAL above for the hole that closes).
    //
    // The peek is not redundant with that later charge. better-auth writes the
    // `verification` row BEFORE it calls sendMagicLink, so without an early
    // refusal every request arriving at an already-drained quota would write a DB
    // row and only then be refused - turning an exhausted quota into a free write
    // amplifier. Peeking keeps the fail-fast behavior the charge used to give us,
    // without spending a slot on input better-auth has not vetted yet.
    //
    // NOTE this ordering only holds for requests that come through Hono. A
    // server-side `auth.api.signInMagicLink(...)` call would skip this middleware
    // entirely - no IP charge, no address charge - and still land in
    // sendMagicLink, charging only the global quota. Nothing calls it that way
    // today. If something ever does, it is stepping around two of the three
    // buckets and needs to say why.
    if (c.req.path === MAGIC_LINK_SEND_PATH) {
      const emailKey = await emailBucketKey(c.env.BETTER_AUTH_SECRET, await magicLinkEmail(c))
      // Read the clock again after those awaits. Other requests may have
      // started a newer window meanwhile; Retry-After counted from the
      // earlier time would be longer than the window.
      const sendNow = Date.now()
      const byEmail = consume(db, MAGIC_LINK_SEND_EMAIL, emailKey, sendNow)
      if (byEmail) return byEmail

      const quota = peekMagicLinkGlobalQuota(db, sendNow)
      if (!quota.ok) return tooManyRequests(quota)
    }

    return next()
  },
)
