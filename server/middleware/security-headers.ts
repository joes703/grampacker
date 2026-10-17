import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../env'

// One security-header map covers the SPA shell, static assets, and API
// responses. Keeping it in middleware lets tests assert the same policy on
// every response shape. The site is served directly by the Node process, so
// no edge layer injects scripts or changes this policy.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Strict on purpose: React sets style={} props through the CSSOM
  // (element.style), which CSP does not block - 'unsafe-inline' is only
  // needed for parser-inserted style attributes and <style> tags, and
  // the app has neither (Codex review, PR #11). If a transplanted
  // component ever breaks styling under preview, loosen deliberately.
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
].join('; ')

// Dev-vs-prod classification, and the ONE thing in this middleware that could
// throw: `new URL()` rejects a malformed BETTER_AUTH_URL. That matters more than
// it looks. Hono catches errors at EACH composed middleware frame, so a throw
// here while unwinding from an already-failed request invokes app.onError a
// SECOND time - the client gets the second correlation id while the real
// incident sits in the logs under an orphaned one. Non-throwing at the source is
// the fix; the error handler cannot repair it from below.
//
// Fails CLOSED: an unparseable origin is treated as production, so the full
// header set (including CSP) applies rather than the relaxed dev set.
export function isDevEnvironment(env: AppEnv): boolean {
  try {
    return new URL(env.BETTER_AUTH_URL).hostname === 'localhost'
  } catch {
    return false
  }
}

export function securityHeaderMap(opts: { dev: boolean }): Record<string, string> {
  return {
    // Dev only: Vite's HMR client and the react-refresh preamble are
    // inline scripts plus a websocket, which the production CSP blocks
    // outright (blank page). Every other header applies in both modes.
    ...(opts.dev ? {} : { 'Content-Security-Policy': CSP }),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    // Ignored by browsers over plain http, so harmless in dev.
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Cross-Origin-Opener-Policy': 'same-origin',
  }
}

export const securityHeaders = createMiddleware<{ Bindings: AppEnv }>(
  async (c, next) => {
    await next()
    const dev = isDevEnvironment(c.env)
    // Some responses (static files) arrive with headers that should not be
    // edited in place; reconstruct before writing.
    const res = new Response(c.res.body, c.res)
    for (const [key, value] of Object.entries(securityHeaderMap({ dev }))) {
      res.headers.set(key, value)
    }
    c.res = res
  },
)
