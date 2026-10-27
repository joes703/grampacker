import { Hono } from 'hono'
import { parseBody } from './parse-body'
import { toGearItemResponse } from './gear-item-response'
import {
  CATEGORY_CAP,
  GEAR_ITEM_CAP,
  bulkDeleteRequestSchema,
  bulkMoveRequestSchema,
  createGearItemRequestSchema,
  importGearStructureSchema,
  reorderRequestSchema,
  updateGearItemRequestSchema,
  type CreateGearItemRequest,
  type ImportGearResponse,
  type UpdateGearItemRequest,
} from '../../shared/gear'
import { requireSession, type SessionVars } from '../middleware/session'
import { dollarsToCents } from './money'
import type {
  CreateGearItemInput,
  ImportGearResult,
  UpdateGearItemPatch,
} from '../repos/gear-items'
import type { AppDeps } from '../env'

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
// The import failure map, in the same exhaustive-switch pattern as the
// write-failure maps in lists.ts: a new repo reason fails the build instead
// of falling through to a wrong default. cap_exceeded here is the GEAR cap.
function importGearFailure(
  result: Extract<ImportGearResult, { ok: false }>,
): { status: 400 | 422; error: string } {
  switch (result.reason) {
    case 'invalid_category':
      return { status: 400, error: 'Invalid category' }
    case 'category_cap_exceeded':
      return { status: 422, error: `Category limit reached (${CATEGORY_CAP} per user)` }
    case 'cap_exceeded':
      return { status: 422, error: `Gear item limit reached (${GEAR_ITEM_CAP} per user)` }
  }
}

export const gearItemRoutes = new Hono<{
  Bindings: AppDeps
  Variables: SessionVars
}>()

gearItemRoutes.use('*', requireSession)

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
  const parsed = await parseBody(c, createGearItemRequestSchema)
  if (!parsed.ok) return parsed.response
  const result = await c
    .get('repos')
    .gearItems.create(toCreateInput(parsed.data))
  if (!result.ok) {
    if (result.reason === 'invalid_category') {
      return c.json({ error: 'Invalid category' }, 400)
    }
    return c.json({ error: `Gear item limit reached (${GEAR_ITEM_CAP} per user)` }, 422)
  }
  return c.json(toGearItemResponse(result.row), 201)
})

gearItemRoutes.put('/order', async (c) => {
  const parsed = await parseBody(c, reorderRequestSchema)
  if (!parsed.ok) return parsed.response
  const ok = await c.get('repos').gearItems.reorder(parsed.data)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

gearItemRoutes.post('/import', async (c) => {
  // Two-stage parse. Stage 1 validates the FULL shape - element schemas and
  // the relational refinements - with no array maxima, so anything malformed
  // (including a malformed OVERSIZED body) stays the uniform 400. Stage 2
  // answers the caps in the trigger's own 422 dialect, which matters because
  // an over-cap gear CSV is user-reachable (the parser accepts 2000 rows)
  // and used to burn 500+ executed statements before failing. Categories
  // are checked first on purpose: every declared category must be
  // referenced, so 501 valid categories force >=501 items - when both caps
  // are blown, the category message is the actionable one.
  const parsed = await parseBody(c, importGearStructureSchema)
  if (!parsed.ok) return parsed.response
  if (parsed.data.categories.length > CATEGORY_CAP) {
    return c.json(
      { error: `Category limit reached (${CATEGORY_CAP} per user)` },
      422,
    )
  }
  if (parsed.data.items.length > GEAR_ITEM_CAP) {
    return c.json(
      { error: `Gear item limit reached (${GEAR_ITEM_CAP} per user)` },
      422,
    )
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
    const f = importGearFailure(result)
    return c.json({ error: f.error }, f.status)
  }
  const body: ImportGearResponse = {
    createdCategories: result.createdCategories,
    createdItems: result.createdItems,
  }
  return c.json(body, 201)
})

gearItemRoutes.post('/bulk-delete', async (c) => {
  const parsed = await parseBody(c, bulkDeleteRequestSchema)
  if (!parsed.ok) return parsed.response
  const ok = await c.get('repos').gearItems.bulkDelete(parsed.data.ids)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

gearItemRoutes.post('/bulk-move', async (c) => {
  const parsed = await parseBody(c, bulkMoveRequestSchema)
  if (!parsed.ok) return parsed.response
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
  const parsed = await parseBody(c, updateGearItemRequestSchema)
  if (!parsed.ok) return parsed.response
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
