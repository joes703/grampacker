import { Hono } from 'hono'
import {
  bulkDeleteRequestSchema,
  bulkMoveRequestSchema,
  createGearItemRequestSchema,
  gearStatusSchema,
  importGearRequestSchema,
  reorderRequestSchema,
  updateGearItemRequestSchema,
  type CreateGearItemRequest,
  type GearItemResponse,
  type ImportGearResponse,
  type UpdateGearItemRequest,
} from '../../shared/gear'
import { requireSession, type SessionVars } from '../middleware/session'
import { dollarsToCents } from './money'
import type {
  CreateGearItemInput,
  GearItemRow,
  UpdateGearItemPatch,
} from '../repos/gear-items'

// Authz matrix rows (docs/authz-matrix.md):
//   GET    /api/gear-items             - session - own rows only
//   POST   /api/gear-items             - session - creates own row; 400 on
//                                        non-owned category, 422 at the cap
//   PUT    /api/gear-items/order       - session - own rows, all-or-nothing
//   POST   /api/gear-items/import      - session - creates own rows; 400 on
//                                        non-owned category, 422 at the cap,
//                                        atomic (zero writes on failure)
//   POST   /api/gear-items/bulk-delete - session - own rows, all-or-nothing
//   POST   /api/gear-items/bulk-move   - session - own rows + own target
//                                        category, all-or-nothing
//   PATCH  /api/gear-items/:id         - session - own row or 404
//   DELETE /api/gear-items/:id         - session - own row or 404
export const gearItemRoutes = new Hono<{
  Bindings: Env
  Variables: SessionVars
}>()

gearItemRoutes.use('*', requireSession)

// Dollars <-> integer cents at the DTO edge; the epsilon guard in the
// schema guarantees the rounding is exact.

function toGearItemResponse(row: GearItemRow): GearItemResponse {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    weightGrams: row.weightGrams,
    cost: row.costCents === null ? null : row.costCents / 100,
    purchaseDate: row.purchaseDate,
    status: gearStatusSchema.parse(row.status),
    sortOrder: row.sortOrder,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }
}

function toCreateInput(body: CreateGearItemRequest): CreateGearItemInput {
  return {
    name: body.name,
    description: body.description,
    weightGrams: body.weightGrams,
    categoryId: body.categoryId,
    costCents: dollarsToCents(body.cost),
    purchaseDate: body.purchaseDate,
    status: body.status,
  }
}

function toUpdatePatch(body: UpdateGearItemRequest): UpdateGearItemPatch {
  const patch: UpdateGearItemPatch = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = body.description
  if (body.weightGrams !== undefined) patch.weightGrams = body.weightGrams
  if (body.categoryId !== undefined) patch.categoryId = body.categoryId
  if (body.cost !== undefined) patch.costCents = dollarsToCents(body.cost)
  if (body.purchaseDate !== undefined) patch.purchaseDate = body.purchaseDate
  if (body.status !== undefined) patch.status = body.status
  return patch
}

gearItemRoutes.get('/', async (c) => {
  const rows = await c.get('repos').gearItems.list()
  return c.json(rows.map(toGearItemResponse))
})

gearItemRoutes.post('/', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = createGearItemRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const result = await c
    .get('repos')
    .gearItems.create(toCreateInput(parsed.data))
  if (!result.ok) {
    if (result.reason === 'invalid_category') {
      return c.json({ error: 'Invalid category' }, 400)
    }
    return c.json({ error: 'Gear item limit reached (500 per user)' }, 422)
  }
  return c.json(toGearItemResponse(result.row), 201)
})

gearItemRoutes.put('/order', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = reorderRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const ok = await c.get('repos').gearItems.reorder(parsed.data)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

gearItemRoutes.post('/import', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = importGearRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const result = await c.get('repos').gearItems.importBatch({
    categories: parsed.data.categories,
    items: parsed.data.items.map((item) => ({
      name: item.name,
      description: item.description,
      weightGrams: item.weightGrams,
      costCents: dollarsToCents(item.cost),
      purchaseDate: item.purchaseDate,
      category: item.category,
    })),
  })
  if (!result.ok) {
    if (result.reason === 'invalid_category') {
      return c.json({ error: 'Invalid category' }, 400)
    }
    return c.json({ error: 'Gear item limit reached (500 per user)' }, 422)
  }
  const body: ImportGearResponse = {
    createdCategories: result.createdCategories,
    createdItems: result.createdItems,
  }
  return c.json(body, 201)
})

gearItemRoutes.post('/bulk-delete', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = bulkDeleteRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const ok = await c.get('repos').gearItems.bulkDelete(parsed.data.ids)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

gearItemRoutes.post('/bulk-move', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = bulkMoveRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const result = await c
    .get('repos')
    .gearItems.bulkMove(parsed.data.ids, parsed.data.categoryId)
  if (result === 'invalid_category') {
    return c.json({ error: 'Invalid category' }, 400)
  }
  if (result === 'not_found') {
    return c.json({ error: 'Not found' }, 404)
  }
  return c.body(null, 204)
})

gearItemRoutes.patch('/:id', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = updateGearItemRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const result = await c
    .get('repos')
    .gearItems.update(c.req.param('id'), toUpdatePatch(parsed.data))
  if (!result.ok) {
    if (result.reason === 'invalid_category') {
      return c.json({ error: 'Invalid category' }, 400)
    }
    return c.json({ error: 'Not found' }, 404)
  }
  return c.json(toGearItemResponse(result.row))
})

gearItemRoutes.delete('/:id', async (c) => {
  const ok = await c.get('repos').gearItems.remove(c.req.param('id'))
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})
