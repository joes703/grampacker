import { Hono } from 'hono'
import { type MeResponse } from '../../shared/me'
import { requireSession, type SessionVars } from '../middleware/session'
import type { SelfRow } from '../repos/users'

// Authz matrix rows (docs/authz-matrix.md):
//   GET /api/me - session - self row only - MeResponse
//
// POST /api/me/reauth is NOT here: it verifies a password, which is a
// better-auth operation the import boundary keeps out of route handlers. It
// is mounted from the composition root (server/middleware/reauth.ts).
//
// GET-only: the former PUT existed solely to update the display name, and
// grampacker no longer collects or stores one (data-minimization call,
// 2026-07-09). The cross-cutting CSRF tests that rode on that PUT live in
// server/middleware/csrf.test.ts now.
export const meRoutes = new Hono<{ Bindings: Env; Variables: SessionVars }>()

meRoutes.use('*', requireSession)

function toMeResponse(row: SelfRow): MeResponse {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt.toISOString(),
  }
}

meRoutes.get('/', async (c) => {
  const row = await c.get('repos').users.getSelf()
  // A valid session whose user row is gone (deleted account, stale cookie).
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(toMeResponse(row))
})
