import { Hono } from 'hono'
import { parseBody } from './parse-body'
import {
  CATEGORY_CAP,
  createCategoryRequestSchema,
  reorderRequestSchema,
  updateCategoryRequestSchema,
  type CategoryResponse,
} from '../../shared/gear'
import { requireSession, type SessionVars } from '../middleware/session'
import type { CategoryRow } from '../repos/categories'
import type { AppEnv } from '../env'

// Authz matrix rows (docs/authz-matrix.md):
//   GET    /api/categories        - session - own rows only
//   POST   /api/categories        - session - creates own row; 422 at the cap
//   PUT    /api/categories/order  - session - own rows, all-or-nothing
//   PATCH  /api/categories/:id    - session - own row or 404
//   DELETE /api/categories/:id    - session - own row or 404; uncategorizes
//                                   its gear in the same transaction
export const categoryRoutes = new Hono<{
  Bindings: AppEnv
  Variables: SessionVars
}>()

categoryRoutes.use('*', requireSession)

function toCategoryResponse(row: CategoryRow): CategoryResponse {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    createdAt: new Date(row.createdAt).toISOString(),
  }
}

categoryRoutes.get('/', async (c) => {
  const rows = await c.get('repos').categories.list()
  return c.json(rows.map(toCategoryResponse))
})

categoryRoutes.post('/', async (c) => {
  const parsed = await parseBody(c, createCategoryRequestSchema)
  if (!parsed.ok) return parsed.response
  const result = await c.get('repos').categories.create(parsed.data.name)
  if (!result.ok) {
    return c.json(
      { error: `Category limit reached (${CATEGORY_CAP} per user)` },
      422,
    )
  }
  return c.json(toCategoryResponse(result.row), 201)
})

// Registered before /:id so the static segment cannot be captured as a
// param (Hono prefers static matches, but explicit order costs nothing).
categoryRoutes.put('/order', async (c) => {
  const parsed = await parseBody(c, reorderRequestSchema)
  if (!parsed.ok) return parsed.response
  const ok = await c.get('repos').categories.reorder(parsed.data)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

categoryRoutes.patch('/:id', async (c) => {
  const parsed = await parseBody(c, updateCategoryRequestSchema)
  if (!parsed.ok) return parsed.response
  const row = await c
    .get('repos')
    .categories.rename(c.req.param('id'), parsed.data.name)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(toCategoryResponse(row))
})

categoryRoutes.delete('/:id', async (c) => {
  const ok = await c.get('repos').categories.remove(c.req.param('id'))
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})
