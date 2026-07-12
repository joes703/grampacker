import { createMiddleware } from 'hono/factory'

// Browser caching for Vite's content-hashed assets.
//
// Cloudflare's assets binding answers with `public, max-age=0, must-revalidate`,
// which is right for the SPA shell and wrong for everything the shell points at:
// a content-hashed file CANNOT change without changing its name, yet the browser
// was forced back to the network to revalidate it on every navigation and reload.
// That throws away the entire point of the content hash. On a throttled mobile
// trace the stylesheet revalidation alone sat ~589ms on the critical path
// (~492ms of FCP/LCP) - the single biggest win in the perf review.
//
// So: hashed assets get a year, and `immutable` on top so the browser does not
// even revalidate on reload. The shell keeps must-revalidate, because the shell is
// what carries the current hashes.
const ONE_YEAR_IMMUTABLE = 'public, max-age=31536000, immutable'

// `/assets/<name>-<8-char hash>.<ext>` - Vite's default `[name]-[hash][extname]`
// (e.g. index-BuiCutTI.js, MarkdownContent-KSirfDAE.js). Greedy `.+` so it is the
// LAST dash-group that must look like a hash: names contain dashes too.
//
// Deliberately not a bare `/assets/*` prefix. Only a name that carries a content
// hash may be cached immutably, because only that name is guaranteed to change
// when its bytes do. A path that merely LIVES under /assets/ could be replaced in
// place, and a year of immutable caching would be unfixable.
const HASHED_ASSET = /^\/assets\/.+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/

// Positive allowlist, not "anything that isn't HTML".
//
// This is the load-bearing guard, and the reason is not obvious: wrangler.jsonc
// sets `not_found_handling: "single-page-application"`, so a request for an asset
// that DOES NOT EXIST does not 404 - the binding serves index.html with status
// 200. Match on the path alone and a typo'd or stale asset URL gets a year of
// immutable caching on an HTML body, and any browser that stored it is wedged for
// a year with no way to bust it. A self-inflicted outage, cached.
//
// "not text/html" would cover that one case. An allowlist also covers the ones we
// have not thought of: an error page, a JSON body, a plain-text response served
// under a hash-shaped path stays uncached rather than being frozen for a year.
// Fail closed - an unrecognized type simply does not get the header.
const IMMUTABLE_TYPES = new Set([
  'text/javascript',
  'application/javascript',
  'text/css',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'font/woff',
  'font/woff2',
  'font/ttf',
  'font/otf',
])

// `text/css; charset=utf-8` and `TEXT/CSS` are both this type. Compare the essence
// only: parameters and case are not part of the identity.
function mediaType(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase()
}

// Drop `If-None-Match` / `If-Modified-Since` from requests for hashed assets, so
// the assets binding answers 200 with a body instead of 304 Not Modified.
//
// Without this the whole optimization silently fails for the users who already
// have the app - which is everyone, on the deploy that introduces it. A browser
// holding a copy cached under the OLD `max-age=0, must-revalidate` policy
// revalidates it, the binding answers 304, and a 304 never carries the new
// Cache-Control - so the stored entry keeps its must-revalidate policy and keeps
// revalidating, forever, until the file's hash happens to change. Only brand-new
// visitors would ever see the benefit.
//
// The obvious alternative - stamp the header onto 304s as well, which RFC 9111
// 4.3.4 says a cache must merge into the stored response - is NOT safe here: a
// 304 has no Content-Type, so the allowlist that keeps an SPA-fallback HTML body
// from being frozen (see IMMUTABLE_TYPES) cannot run, and a 304 validating a
// previously-cached fallback at a bogus asset URL would be frozen for a year.
//
// So force the 200 instead. It costs one full re-download per asset per browser,
// exactly once: the 200 carries `immutable`, and an immutable response is never
// revalidated again. A one-off body in exchange for permanently removing the
// round trip - and it keeps the Content-Type guard in play, which is what makes
// the poisoning case unreachable.
export function forceValidatedAssetResponse(req: Request): Request {
  if (!HASHED_ASSET.test(new URL(req.url).pathname)) return req
  if (!req.headers.has('if-none-match') && !req.headers.has('if-modified-since')) {
    return req
  }
  const headers = new Headers(req.headers)
  headers.delete('if-none-match')
  headers.delete('if-modified-since')
  return new Request(req, { headers })
}

export const assetCache = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  await next()

  if (!HASHED_ASSET.test(c.req.path)) return
  // A redirect, a 404, or a range response is not a cacheable immutable asset.
  if (c.res.status !== 200) return
  if (!IMMUTABLE_TYPES.has(mediaType(c.res.headers.get('content-type')))) return

  // Responses proxied from ASSETS.fetch have immutable headers; rebuild to write.
  // Only reached for a real hashed asset, so the copy is not on the API path.
  const res = new Response(c.res.body, c.res)
  res.headers.set('Cache-Control', ONE_YEAR_IMMUTABLE)

  // Clear c.res BEFORE assigning the replacement, or the assignment silently
  // undoes the line above.
  //
  // Hono's `set res()` merges when a response is already present: it copies the
  // OLD response's headers onto the incoming one with `headers.set(k, v)`, so on
  // any name that exists in both, the OLD value wins. Cache-Control exists on
  // both - that is the entire point of this middleware - so a plain `c.res = res`
  // restores the binding's `max-age=0, must-revalidate` and the header we just
  // set is thrown away. (securityHeaders gets away with the same pattern only
  // because CSP, X-Frame-Options and friends are not present on the original
  // response, so nothing collides.)
  //
  // Assigning undefined first skips that merge branch, which is how Hono lets a
  // middleware genuinely REPLACE a response rather than decorate it. Caught by
  // CI: the header was simply absent, with no error anywhere.
  c.res = undefined
  c.res = res
})
