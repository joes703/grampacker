import { Hono } from 'hono'
import {
  saveTargetDefaultsRequestSchema,
  type TargetDefaultsResponse,
} from '../../shared/food-plans'
import { requireSession, type SessionVars } from '../middleware/session'

// Authz matrix rows (docs/authz-matrix.md):
//   GET /api/target-defaults - session - own rows only
//   PUT /api/target-defaults - session - FULL replace of own rows, atomic
//
// Account-level default daily targets (slice 7). Copied by value into each
// NEW food plan at create; nothing here reaches into existing plans, and
// nothing here is ever anon-reachable.
export const targetDefaultRoutes = new Hono<{
  Bindings: Env
  Variables: SessionVars
}>()

targetDefaultRoutes.use('*', requireSession)

targetDefaultRoutes.get('/', async (c) => {
  const defaults = await c.get('repos').targetDefaults.list()
  return c.json<TargetDefaultsResponse>({ defaults })
})

targetDefaultRoutes.put('/', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = saveTargetDefaultsRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const defaults = await c
    .get('repos')
    .targetDefaults.replaceAll(parsed.data.defaults)
  return c.json<TargetDefaultsResponse>({ defaults })
})
