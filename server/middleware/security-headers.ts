import { createMiddleware } from 'hono/factory'

// One security-header map, owned by the Worker and applied to EVERY
// response - the SPA shell, static assets, and /api/* alike. The old
// repo carried this set in public/_headers, a Pages convention that
// does not port to the Node target; a middleware does (REWRITE_PLAN.md
// section 6). run_worker_first in wrangler.jsonc routes all requests
// through the Worker so no response can bypass the map.
//
// The CSP is the old app's minus what died with Supabase: connect-src loses
// the two Supabase origins (the API is same-origin now).
//
// script-src allows ONE third-party origin, deliberately. Cloudflare Web
// Analytics is enabled on the zone, and Cloudflare injects its beacon into
// our HTML at the edge - after the Worker returns, so nothing in this repo
// can see it, which is how the comment here used to claim (wrongly) that the
// beacon "is not wired". It is. Confirmed on the wire: the edge only injects
// when the request carries `Accept: text/html`, so a plain curl shows a clean
// 395-byte document and a real browser gets the beacon. That false negative is
// exactly why the contradiction survived a review.
//
// So the choice was never "allow it or stay pure" - it was "allow it or keep
// shipping a script the browser blocks on every page load": analytics
// collecting nothing, a wasted third-party request each load, and a permanent
// CSP violation in the console that would mask the next real one.
//
// The grant is PATH-restricted, not host-wide. A host-only source
// (`https://static.cloudflareinsights.com`) authorizes every executable path on
// that origin, today and forever - anything Cloudflare ever chooses to host
// there becomes runnable on a page that holds a live session. Restricting to the
// beacon's own path costs nothing and is the difference between allowing one
// script and allowing an origin.
//
// BOTH path shapes are listed because CSP path matching is exact unless the
// source ends in '/', in which case it is a prefix match. Cloudflare currently
// injects the versioned form (/beacon.min.js/v4513...), which needs the prefix
// source; the bare form is listed too so a change in Cloudflare's URL shape
// cannot silently re-break analytics. Both fail CLOSED (a blocked script, not a
// widened policy), so the cost of being wrong here is data, never safety.
//
// On SRI, be careful not to overclaim (an earlier draft did): the injected tag
// carries `integrity="sha512-..."` + `crossorigin="anonymous"`, so the browser
// refuses bytes that do not match the hash the edge advertised. But CLOUDFLARE
// chooses both the tag and the script, so it is Cloudflare-selected integrity,
// not an application-controlled pin - it can rotate the URL and the hash
// together, and we would never know. It defends against a tampered response
// from static.cloudflareinsights.com; it does NOT constrain Cloudflare.
//
// Why that is still acceptable here: Cloudflare already terminates our TLS and
// serves our origin, so this adds no NEW administrative trust principal. It does
// widen the browser-enforced authority available to more Cloudflare
// infrastructure, and a vulnerability on that host would now reach a page
// holding a session cookie. Real, bounded, and worth saying out loud rather than
// filing under "vendor, therefore fine".
//
// connect-src is deliberately NOT widened. An edge-INJECTED beacon reports to
// the same-origin /cdn-cgi/rum (only a manually-embedded one talks to
// cloudflareinsights.com), and `connect-src 'self'` already permits that.
// Allowing the static origin as a connection destination would hand a
// third-party script an exfiltration target in exchange for nothing it needs.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://static.cloudflareinsights.com/beacon.min.js https://static.cloudflareinsights.com/beacon.min.js/",
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
export function isDevEnvironment(env: Env): boolean {
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

export const securityHeaders = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    await next()
    const dev = isDevEnvironment(c.env)
    // Responses proxied from ASSETS.fetch have immutable headers;
    // reconstruct before writing.
    const res = new Response(c.res.body, c.res)
    for (const [key, value] of Object.entries(securityHeaderMap({ dev }))) {
      res.headers.set(key, value)
    }
    c.res = res
  },
)
