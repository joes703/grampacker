import { createMiddleware } from 'hono/factory'
import { lt, sql } from 'drizzle-orm'
import { createDb } from '../db'
import { rateLimits } from '../db/schema'

type Rule = { scope: string; limit: number; windowMs: number }

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

// Day-one abuse posture for public signup (REWRITE_PLAN.md section 13,
// decision 2): fixed-window counters per scope+IP in the rate_limits table.
// Plain SQLite, no Cloudflare-only primitives - the WAF is hardening on
// top, not the mechanism. Budgets are deliberately tight; there are no
// real users to inconvenience yet. sign-up and the email-sending endpoints
// also guard the Resend free tier (100 sends/day).
const SIGN_UP: Rule = { scope: 'sign-up', limit: 10, windowMs: DAY }
const EMAIL_SEND: Rule = { scope: 'email-send', limit: 5, windowMs: DAY }
const SIGN_IN: Rule = { scope: 'sign-in', limit: 10, windowMs: 10 * MINUTE }
const AUTH_DEFAULT: Rule = { scope: 'auth', limit: 30, windowMs: 10 * MINUTE }

// Longest window; rows older than this are dead and get swept.
const MAX_WINDOW_MS = DAY

// Endpoints that trigger an outbound email besides sign-up. better-auth
// 1.6 ships both password-reset spellings; cover both.
const EMAIL_SEND_PATHS = new Set([
  '/api/auth/send-verification-email',
  '/api/auth/forget-password',
  '/api/auth/request-password-reset',
])

function ruleFor(path: string): Rule {
  if (path.startsWith('/api/auth/sign-up')) return SIGN_UP
  if (EMAIL_SEND_PATHS.has(path)) return EMAIL_SEND
  if (path.startsWith('/api/auth/sign-in')) return SIGN_IN
  return AUTH_DEFAULT
}

// GET is NOT read-only in better-auth: the passkey plugin's
// /passkey/generate-*-options endpoints are GETs that write a challenge
// row to the verification table (generate-authenticate-options without
// even a session). So the limiter is fail-closed across ALL methods,
// with an explicit allowlist of pure-read GETs that clients hit
// routinely and that must never 429 (the session poll fires after every
// auth mutation). A new endpoint is limited until it earns a spot here.
const READ_ONLY_GET_PATHS = new Set([
  '/api/auth/get-session',
  '/api/auth/passkey/list-user-passkeys',
])

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
    const ip = c.req.header('cf-connecting-ip') ?? 'local'
    const key = `${rule.scope}:${ip}`
    const now = Date.now()
    const cutoff = now - rule.windowMs
    const db = createDb(c.env.DB)

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

    if (row.count > rule.limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((row.windowStart + rule.windowMs - now) / 1000),
      )
      return c.json(
        { error: 'Too many requests' },
        429,
        { 'Retry-After': String(retryAfterSeconds) },
      )
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

    return next()
  },
)
