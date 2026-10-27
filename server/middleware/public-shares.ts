import { createMiddleware } from 'hono/factory'
import { createPublicSharesRepo, type PublicSharesRepo } from '../repos/public-shares'
import type { AppDeps } from '../env'

export type PublicShareVars = {
  publicShares: PublicSharesRepo
}

// The anonymous counterpart of requireSession: no auth check (the share
// slug IS the access mechanism; the repo self-gates on is_shared), but the
// same construction discipline - handlers get their data access from
// c.get(...), never from the DB factory directly, so the import boundary
// in eslint.config.js holds for the public surface too.
export const attachPublicShares = createMiddleware<{
  Bindings: AppDeps
  Variables: PublicShareVars
}>(async (c, next) => {
  c.set('publicShares', createPublicSharesRepo(c.env.db))
  return next()
})
