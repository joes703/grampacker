import { Hono } from 'hono'
import { type MeResponse } from '../../shared/me'
import { requireSession, type SessionVars } from '../middleware/session'
import type { SelfRow } from '../repos/users'
import type { AppDeps } from '../env'

// Authz matrix rows (docs/authz-matrix.md):
//   GET /api/me - session - self row only - MeResponse
//
// GET-only: grampacker does not collect or store a display name, so there is
// nothing to update. The cross-cutting CSRF tests live in
// server/middleware/csrf.test.ts.
//
// There is no reauth route. Proving "it is really you" is a fresh session,
// which only a sign-in ceremony can mint (enforced by the hooks.before gate
// in server/auth.ts).
export const meRoutes = new Hono<{ Bindings: AppDeps; Variables: SessionVars }>()

meRoutes.use('*', requireSession)

function toMeResponse(row: SelfRow, passkeyCount: number): MeResponse {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt.toISOString(),
    passkeyCount,
  }
}

meRoutes.get('/', async (c) => {
  const users = c.get('repos').users
  const row = await users.getSelf()
  // A valid session whose user row is gone (deleted account, stale cookie).
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(toMeResponse(row, await users.passkeyCount()))
})
