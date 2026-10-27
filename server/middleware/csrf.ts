import { createMiddleware } from 'hono/factory'
// The header name lives in shared/ so the SPA fetch wrapper and this
// middleware cannot drift. Re-exported for existing server-side importers.
export { CSRF_HEADER } from '../../shared/api'
import { CSRF_HEADER } from '../../shared/api'
import type { AppDeps } from '../env'

// Belt-and-braces CSRF for our API routes (SameSite=Strict cookies are the
// first layer). better-auth routes are skipped - better-auth does its own
// origin validation against baseURL (verified: forged origin -> 403
// INVALID_ORIGIN).
export const csrfProtection = createMiddleware<{ Bindings: AppDeps }>(
  async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) {
      return next()
    }
    const method = c.req.method.toUpperCase()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next()
    }
    if (c.req.header(CSRF_HEADER) !== '1') {
      return c.json({ error: 'Missing required request header' }, 403)
    }
    const origin = c.req.header('origin')
    if (origin && origin !== c.env.origin) {
      return c.json({ error: 'Invalid origin' }, 403)
    }
    await next()
  },
)
