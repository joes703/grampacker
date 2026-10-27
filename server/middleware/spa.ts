import { serveStatic } from '@hono/node-server/serve-static'
import type { Handler } from 'hono'

// Serves the built SPA from STATIC_DIR: real files as themselves, and
// index.html for any other path so client-side routes work on deep links.
//
// - GET and HEAD only. serveStatic itself skips other methods, which would
//   fall through to a 404; we answer 405 with Allow instead.
// - A missing file under /assets/ is a 404, not the shell. Only a hashed name
//   under /assets/ is ever requested by the shell, so a miss there is a stale
//   or mistyped URL, and answering it with HTML at a .js URL helps no one.
// - No 304 responses: serveStatic does not do conditional requests. A 304
//   carries no Cache-Control, so a browser that revalidated a hashed asset
//   would keep its old policy (server/middleware/asset-cache.test.ts pins it).
//
// Everything under STATIC_DIR is public, dotfiles included, and symlinks are
// followed: serveStatic only refuses `.`/`..` path segments. So STATIC_DIR must
// hold nothing but the SPA build output (dist/client).

// The shell carries the current asset hashes, so it must always revalidate.
const SHELL_CACHE_CONTROL = 'public, max-age=0, must-revalidate'

// A content-hashed file cannot change without changing its name, so it is
// cached for a year and `immutable` (no revalidation even on reload).
const ONE_YEAR_IMMUTABLE = 'public, max-age=31536000, immutable'

// `/assets/<name>-<8-char hash>.<ext>` - Vite's `[name]-[hash][extname]`.
// Greedy `.+` so it is the LAST dash-group that must look like a hash. Not a
// bare `/assets/*` prefix: only a name that carries a content hash changes
// when its bytes do, so only that name may be cached immutably.
const HASHED_ASSET = /^\/assets\/.+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/

// A positive allowlist of types, so a hash-shaped path answered with HTML, JSON
// or an error page is never frozen for a year. One change to the fallback
// above could otherwise wedge a browser on an HTML body for a year, with no way
// to bust it. Fail closed: an unrecognized type keeps the shell policy.
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

// Compare the media type only: parameters and case are not part of it.
function mediaType(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase()
}

function cacheControlFor(path: string, res: Response): string {
  // A 404, a redirect or a range response (206) is not a cacheable asset.
  return HASHED_ASSET.test(path) &&
    res.status === 200 &&
    IMMUTABLE_TYPES.has(mediaType(res.headers.get('content-type')))
    ? ONE_YEAR_IMMUTABLE
    : SHELL_CACHE_CONTROL
}

// The last handler for every non-API path. Built once per app with its root.
export function createServeSpa(root: string): Handler {
  const file = serveStatic({ root })
  const shell = serveStatic({ root, path: 'index.html' })
  return async (c) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      return c.text('Method Not Allowed', 405, { Allow: 'GET, HEAD' })
    }
    let res = await file(c, async () => {})
    if (!res && !c.req.path.startsWith('/assets/')) {
      res = await shell(c, async () => {})
    }
    if (!res) return c.text('Not Found', 404)
    res.headers.set('Cache-Control', cacheControlFor(c.req.path, res))
    return res
  }
}
