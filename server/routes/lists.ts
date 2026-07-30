import { Hono } from 'hono'
import { gearStatusSchema } from '../../shared/gear'
import {
  addListItemRequestSchema,
  createListFromSelectionRequestSchema,
  createListRequestSchema,
  importListRequestSchema,
  quickAddListItemRequestSchema,
  reorderListItemsRequestSchema,
  reorderListsRequestSchema,
  updateListItemRequestSchema,
  updateListRequestSchema,
  type ListItemResponse,
  type ListResponse,
} from '../../shared/lists'
import { requireSession, type SessionVars } from '../middleware/session'
import { dollarsToCents } from './money'
import type { GearItemRow } from '../repos/gear-items'
import type { ListItemWithGear, ListItemWriteResult } from '../repos/list-items'
import type { ListRow } from '../repos/lists'

// Authz matrix rows (docs/authz-matrix.md):
//   GET    /api/lists                          - session - own rows only
//   POST   /api/lists                          - session - creates own row;
//                                                422 at the 100-list cap
//   PUT    /api/lists/order                    - session - own rows,
//                                                all-or-nothing
//   POST   /api/lists/from-selection           - session - own gear only,
//                                                all-or-nothing, zero writes
//                                                on any foreign id
//   POST   /api/lists/import                   - session - own category/gear
//                                                refs only; creates list +
//                                                categories + gear + items
//                                                atomically, zero writes on
//                                                any failure; 422 at caps
//   POST   /api/lists/:id/duplicate            - session - own list or 404;
//   PATCH  /api/lists/:id                      - session - own list or 404;
//                                                isShared patchable (the
//                                                share/unshare toggle)
//   DELETE /api/lists/:id                      - session - own list or 404;
//                                                cascades membership rows
//   GET    /api/lists/:id/items                - session - own list or 404
//   POST   /api/lists/:id/items                - session - own list + own
//                                                gear; 422 at the 300 cap
//   POST   /api/lists/:id/items/quick-add      - session - own list + own
//                                                category; atomic gear+item
//   PUT    /api/lists/:id/items/order          - session - items of THIS
//                                                list only, all-or-nothing
//   POST   /api/lists/:id/items/reset-packed   - session - own list or 404
//   POST   /api/lists/:id/items/reset-ready    - session - own list or 404
//   PATCH  /api/lists/:id/items/:itemId        - session - item must belong
//                                                to THIS list (parent-path)
//   DELETE /api/lists/:id/items/:itemId        - session - item must belong
//                                                to THIS list (parent-path)
export const listRoutes = new Hono<{
  Bindings: Env
  Variables: SessionVars
}>()

listRoutes.use('*', requireSession)

function toListResponse(row: ListRow): ListResponse {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    slug: row.slug,
    isShared: row.isShared,
    groupWorn: row.groupWorn,
    readyChecksEnabled: row.readyChecksEnabled,
    isDraft: row.isDraft,
    sortOrder: row.sortOrder,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }
}

// Same dollars/ISO conversions as the gear routes, applied to the
// embedded gear row.
function toEmbeddedGear(row: GearItemRow) {
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

function toListItemResponse(row: ListItemWithGear): ListItemResponse {
  return {
    id: row.item.id,
    listId: row.item.listId,
    gearItemId: row.item.gearItemId,
    quantity: row.item.quantity,
    isWorn: row.item.isWorn,
    isConsumable: row.item.isConsumable,
    isPacked: row.item.isPacked,
    isReady: row.item.isReady,
    packingLocationId: row.item.packingLocationId,
    sortOrder: row.item.sortOrder,
    createdAt: new Date(row.item.createdAt).toISOString(),
    updatedAt: new Date(row.item.updatedAt).toISOString(),
    gearItem: toEmbeddedGear(row.gear),
  }
}

// One place for the item-write failure map so every route agrees on
// statuses and wording.
function listItemFailure(result: Extract<ListItemWriteResult, { ok: false }>): {
  status: 400 | 404 | 422
  error: string
} {
  switch (result.reason) {
    case 'list_not_found':
    case 'not_found':
      return { status: 404, error: 'Not found' }
    case 'invalid_gear':
      return { status: 400, error: 'Invalid gear item' }
    case 'invalid_category':
      return { status: 400, error: 'Invalid category' }
    case 'invalid_location':
      return { status: 400, error: 'Invalid packing location' }
    case 'worn_consumable_conflict':
      return {
        status: 400,
        error: 'An item cannot be both worn and consumable',
      }
    case 'gear_cap_exceeded':
      return { status: 422, error: 'Gear item limit reached (500 per user)' }
    case 'cap_exceeded':
      return { status: 422, error: 'List item limit reached (300 per list)' }
  }
}

// --------------------------------------------------------------------- lists

listRoutes.get('/', async (c) => {
  const rows = await c.get('repos').lists.list()
  return c.json(rows.map(toListResponse))
})

listRoutes.post('/', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = createListRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const result = await c.get('repos').lists.create(parsed.data.name)
  if (!result.ok) {
    return c.json({ error: 'List limit reached (100 per user)' }, 422)
  }
  return c.json(toListResponse(result.row), 201)
})

listRoutes.put('/order', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = reorderListsRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const ok = await c.get('repos').lists.reorder(parsed.data)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

listRoutes.post('/from-selection', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = createListFromSelectionRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const result = await c
    .get('repos')
    .lists.createFromSelection(
      parsed.data.name,
      parsed.data.description,
      parsed.data.gearItemIds,
    )
  if (!result.ok) {
    if (result.reason === 'invalid_gear') {
      return c.json({ error: 'Invalid gear item' }, 400)
    }
    return c.json({ error: 'List limit reached (100 per user)' }, 422)
  }
  return c.json(toListResponse(result.row), 201)
})

listRoutes.post('/import', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = importListRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  // cost arrives in dollars on the wire and is stored as integer cents.
  // Converted here, at the route boundary, exactly as the gear import does.
  const result = await c.get('repos').lists.importFromCsv({
    ...parsed.data,
    gear: parsed.data.gear.map(({ cost, ...g }) => ({
      ...g,
      costCents: dollarsToCents(cost),
    })),
  })
  if (!result.ok) {
    if (result.reason === 'invalid_category') {
      return c.json({ error: 'Invalid category' }, 400)
    }
    if (result.reason === 'invalid_gear') {
      return c.json({ error: 'Invalid gear item' }, 400)
    }
    if (result.reason === 'gear_cap_exceeded') {
      return c.json({ error: 'Gear item limit reached (500 per user)' }, 422)
    }
    if (result.reason === 'item_cap_exceeded') {
      return c.json({ error: 'List item limit reached (300 per list)' }, 422)
    }
    return c.json({ error: 'List limit reached (100 per user)' }, 422)
  }
  return c.json(toListResponse(result.row), 201)
})

listRoutes.post('/:id/duplicate', async (c) => {
  const result = await c.get('repos').lists.duplicate(c.req.param('id'))
  if (!result.ok) {
    if (result.reason === 'not_found') {
      return c.json({ error: 'Not found' }, 404)
    }
    return c.json({ error: 'List limit reached (100 per user)' }, 422)
  }
  return c.json(toListResponse(result.row), 201)
})

listRoutes.patch('/:id', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = updateListRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const result = await c
    .get('repos')
    .lists.update(c.req.param('id'), parsed.data)
  if (!result.ok) return c.json({ error: 'Not found' }, 404)
  return c.json(toListResponse(result.row))
})

listRoutes.delete('/:id', async (c) => {
  const ok = await c.get('repos').lists.remove(c.req.param('id'))
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

// ---------------------------------------------------------------- list items

listRoutes.get('/:id/items', async (c) => {
  const rows = await c.get('repos').listItems.forList(c.req.param('id'))
  if (rows === null) return c.json({ error: 'Not found' }, 404)
  return c.json(rows.map(toListItemResponse))
})

listRoutes.post('/:id/items', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = addListItemRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const result = await c
    .get('repos')
    .listItems.addExisting(c.req.param('id'), parsed.data.gearItemId)
  if (!result.ok) {
    const f = listItemFailure(result)
    return c.json({ error: f.error }, f.status)
  }
  return c.json(toListItemResponse(result.row), 201)
})

listRoutes.post('/:id/items/quick-add', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = quickAddListItemRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const result = await c
    .get('repos')
    .listItems.quickAdd(c.req.param('id'), parsed.data)
  if (!result.ok) {
    const f = listItemFailure(result)
    return c.json({ error: f.error }, f.status)
  }
  return c.json(toListItemResponse(result.row), 201)
})

listRoutes.put('/:id/items/order', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = reorderListItemsRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const ok = await c
    .get('repos')
    .listItems.reorder(c.req.param('id'), parsed.data)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

listRoutes.post('/:id/items/reset-packed', async (c) => {
  const ok = await c.get('repos').listItems.resetPacked(c.req.param('id'))
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

listRoutes.post('/:id/items/reset-ready', async (c) => {
  const ok = await c.get('repos').listItems.resetReady(c.req.param('id'))
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

listRoutes.patch('/:id/items/:itemId', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = updateListItemRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const result = await c
    .get('repos')
    .listItems.update(c.req.param('id'), c.req.param('itemId'), parsed.data)
  if (!result.ok) {
    const f = listItemFailure(result)
    return c.json({ error: f.error }, f.status)
  }
  return c.json(toListItemResponse(result.row))
})

listRoutes.delete('/:id/items/:itemId', async (c) => {
  const ok = await c
    .get('repos')
    .listItems.remove(c.req.param('id'), c.req.param('itemId'))
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})
