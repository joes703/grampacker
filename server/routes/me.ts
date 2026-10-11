import { Hono } from 'hono'
import { type MeResponse } from '../../shared/me'
import { requireSession, type SessionVars } from '../middleware/session'
import type { SelfRow } from '../repos/users'
import type { AppEnv } from '../env'

// Authz matrix rows (docs/authz-matrix.md):
//   GET /api/me - session - self row only - MeResponse
//
// GET-only: the former PUT existed solely to update the display name, and
// grampacker no longer collects or stores one (data-minimization call,
// 2026-07-09). The cross-cutting CSRF tests that rode on that PUT live in
// server/middleware/csrf.test.ts now.
//
// There is no POST /api/me/reauth any more. Proving "it is really you" was a
// password check; passwordless, it is a fresh session, which only a sign-in
// ceremony can mint (enforced by the hooks.before gate in server/auth.ts).
export const meRoutes = new Hono<{ Bindings: AppEnv; Variables: SessionVars }>()

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
