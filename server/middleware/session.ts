import { createMiddleware } from 'hono/factory'
import { reposForUser, type UserRepos } from '../repos'
import type { AppDeps } from '../env'

export type SessionVars = {
  userId: string
  repos: UserRepos
}

// Rejects anonymous requests with 401; otherwise attaches the user id and
// the user-scoped repositories. Downstream handlers get their data access
// exclusively from c.get('repos') - already scoped, no user id ever taken
// from the client.
export const requireSession = createMiddleware<{
  Bindings: AppDeps
  Variables: SessionVars
}>(async (c, next) => {
  const session = await c.env.auth.api.getSession({
    headers: c.req.raw.headers,
  })
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('userId', session.user.id)
  c.set('repos', reposForUser(c.env.db, session.user.id))
  return next()
})
