import { createMiddleware } from 'hono/factory'
import { createAuth } from '../auth'
import { createDb } from '../db'
import { reposForUser, type UserRepos } from '../repos'
import type { AppEnv } from '../env'

export type SessionVars = {
  userId: string
  repos: UserRepos
}

// Rejects anonymous requests with 401; otherwise attaches the user id and
// the user-scoped repositories. Downstream handlers get their data access
// exclusively from c.get('repos') - already scoped, no user id ever taken
// from the client.
export const requireSession = createMiddleware<{
  Bindings: AppEnv
  Variables: SessionVars
}>(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  })
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('userId', session.user.id)
  c.set('repos', reposForUser(createDb(c.env.DB), session.user.id))
  return next()
})
