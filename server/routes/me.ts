import { Hono } from 'hono'
import {
  updateMeRequestSchema,
  type MeResponse,
} from '../../shared/me'
import { requireSession, type SessionVars } from '../middleware/session'
import type { SelfRow } from '../repos/users'

// Authz matrix rows (docs/authz-matrix.md):
//   GET /api/me - session - self row only - MeResponse
//   PUT /api/me - session - self row only - UpdateMeRequest -> MeResponse
export const meRoutes = new Hono<{ Bindings: Env; Variables: SessionVars }>()

meRoutes.use('*', requireSession)

function toMeResponse(row: SelfRow): MeResponse {
  return {
    id: row.id,
    name: row.name,
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

meRoutes.put('/', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = updateMeRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const row = await c.get('repos').users.updateName(parsed.data.name)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(toMeResponse(row))
})
