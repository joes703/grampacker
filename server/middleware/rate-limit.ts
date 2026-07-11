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
// grants a session. Two different abuses, and IP-keying only stops one:
//
//   1. Burn the Resend quota (100/day, free tier) or spray links at many
//      addresses -> keyed by IP.
//   2. Bomb ONE victim's inbox, or farm tokens for one account, from rotating
//      IPs -> keyed by EMAIL. An IP-only limiter walks straight around this,
//      which is why the per-email bucket exists.
//
// Both are consumed on every send; either one can 429.
const MAGIC_LINK_SEND_IP: Rule = {
  scope: 'magic-send-ip',
  limit: 20,
  windowMs: DAY,
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
  // The dead email endpoints (/sign-in/email, /sign-up/email) land here. They
  // 400 without an emailAndPassword config, but a 400 should still cost budget -
  // an unmetered dead endpoint is still a free request.
  if (path.startsWith('/api/auth/sign-in') || path.startsWith('/api/auth/sign-up')) {
    return SIGN_IN
  }
  return AUTH_DEFAULT
}

// The per-email bucket key. Two things matter here and both are load-bearing:
//
// - NORMALIZE first. better-auth lowercases emails on create and lookup, so
//   Victim@x.com and victim@x.com are one account. Keying the raw input would
//   let an attacker walk around the victim's bucket just by varying case.
// - HMAC, not a bare hash. Without it, rate_limits.key becomes a list of every
//   address that ever requested a link, and a plain SHA-256 of an email address
//   is trivially reversible with a dictionary - it is a lookup key, not a
//   secret. The auth secret is the pepper.
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
    new TextEncoder().encode(email.trim().toLowerCase()),
  )
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

// Reads the email a magic-link request is for, so it can be charged to that
// address's bucket as well as the caller's IP. Hono caches the parsed body, so
// this does not consume it for better-auth downstream.
//
// A body we cannot read gets a stable key rather than a free pass: a malformed
// send is still a request, and letting it skip the bucket would be a bypass.
async function magicLinkEmail(c: {
  req: { json: () => Promise<unknown> }
}): Promise<string> {
  try {
    const body = (await c.req.json()) as { email?: unknown }
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

    // A magic-link send is also charged to the TARGET ADDRESS, not just the
    // sender's IP. Without this, an attacker rotating IPs bombs one victim's
    // inbox at will - each IP looks like a first-time caller. Charged after the
    // IP bucket so a flood from one host is cut off before we bother hashing.
    if (c.req.path === MAGIC_LINK_SEND_PATH) {
      const byEmail = await consume(
        db,
        MAGIC_LINK_SEND_EMAIL,
        await emailBucketKey(c.env.BETTER_AUTH_SECRET, await magicLinkEmail(c)),
        now,
      )
      if (byEmail) return byEmail
    }

    return next()
  },
)
