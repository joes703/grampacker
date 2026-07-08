import { createMiddleware } from 'hono/factory'

// One security-header map, owned by the Worker and applied to EVERY
// response - the SPA shell, static assets, and /api/* alike. The old
// repo carried this set in public/_headers, a Pages convention that
// does not port to the Node target; a middleware does (REWRITE_PLAN.md
// section 6). run_worker_first in wrangler.jsonc routes all requests
// through the Worker so no response can bypass the map.
//
// The CSP is the old app's minus what died with Supabase and Pages:
// connect-src loses the two Supabase origins (the API is same-origin
// now) and script-src loses the Cloudflare insights beacon (Web
// Analytics is not wired to the new Worker; re-add the source
// deliberately if it comes back).
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

export const securityHeaders = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    await next()
    const dev = new URL(c.env.BETTER_AUTH_URL).hostname === 'localhost'
    // Responses proxied from ASSETS.fetch have immutable headers;
    // reconstruct before writing.
    const res = new Response(c.res.body, c.res)
    for (const [key, value] of Object.entries(securityHeaderMap({ dev }))) {
      res.headers.set(key, value)
    }
    c.res = res
  },
)
