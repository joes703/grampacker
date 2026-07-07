import { createMiddleware } from 'hono/factory'

// The SPA's fetch wrapper sends this on every unsafe request. A cross-site
// attacker cannot add a custom header without a CORS preflight, and this
// server never emits CORS headers, so the preflight can never pass.
export const CSRF_HEADER = 'x-grampacker-request'

// Belt-and-braces CSRF for our API routes (SameSite=Strict cookies are the
// first layer). better-auth routes are skipped - better-auth does its own
// origin validation against baseURL (verified: forged origin -> 403
// INVALID_ORIGIN).
export const csrfProtection = createMiddleware<{ Bindings: Env }>(
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
    if (origin && origin !== new URL(c.env.BETTER_AUTH_URL).origin) {
      return c.json({ error: 'Invalid origin' }, 403)
    }
    await next()
  },
)
