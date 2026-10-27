import { serveStatic } from '@hono/node-server/serve-static'
import type { Handler } from 'hono'

// Serves the built SPA from STATIC_DIR: real files as themselves, and
// index.html for any other path so client-side routes work on deep links.
// Unknown non-API paths receive the SPA shell.
//
// Differences from the binding, on purpose:
//
// - GET and HEAD only. serveStatic itself would return a file for any method.
// - A missing file under /assets/ is a 404, not the shell. Only a hashed name
//   under /assets/ is ever requested by the shell, so a miss there is a stale
//   or mistyped URL, and answering it with HTML at a .js URL helps no one.
//   (assetCache refuses to freeze such a response either way.)
// - No 304 responses: serveStatic does not do conditional requests. That keeps
//   the asset-cache trap (a 304 cannot carry the new Cache-Control) out of
//   reach entirely.
//
// Everything under STATIC_DIR is public, dotfiles included, and symlinks are
// followed: serveStatic only refuses `.`/`..` path segments. So STATIC_DIR must
// hold nothing but the SPA build output (dist/client).
//
// Every response here starts with the binding's old default policy,
// `public, max-age=0, must-revalidate`: right for the shell, which carries the
// current asset hashes. assetCache then upgrades content-hashed assets to a
// year, immutable.
const SHELL_CACHE_CONTROL = 'public, max-age=0, must-revalidate'

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
    res.headers.set('Cache-Control', SHELL_CACHE_CONTROL)
    return res
  }
}
