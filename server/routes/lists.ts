import { Hono } from 'hono'
import { LIMIT_REACHED } from './limit-messages'
import { parseBody } from './parse-body'
import { toGearItemResponse } from './gear-item-response'
import {
  addListItemRequestSchema,
  createListFromSelectionRequestSchema,
  createListRequestSchema,
  quickAddListItemRequestSchema,
  reorderListItemsRequestSchema,
  reorderPackListItemsRequestSchema,
  reorderListsRequestSchema,
  updateListItemRequestSchema,
  updateListRequestSchema,
  type ListItemResponse,
  type ListResponse,
} from '../../shared/lists'
import { importListRequestSchema } from '../../shared/list-import'
import { type SessionVars } from '../middleware/session'
import { dollarsToCents } from './money'
import type { ListItemWithGear, ListItemWriteResult } from '../repos/list-items'
import type {
  DuplicateListResult,
  FromSelectionResult,
  ImportListResult,
  ListRow,
  ListWriteResult,
} from '../repos/lists'
import type { AppDeps } from '../env'

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
//   POST   /api/lists/:id/share-link           - session - own list or 404;
//                                                mints a new slug. Old link
//                                                404s from then on. Does NOT
//                                                change isShared
//   DELETE /api/lists/:id                      - session - own list or 404;
//                                                cascades membership rows
//   GET    /api/lists/:id/items                - session - own list or 404
//   POST   /api/lists/:id/items                - session - own list + own
//                                                gear; 422 at the 300 cap
//   POST   /api/lists/:id/items/quick-add      - session - own list + own
//                                                category; atomic gear+item
//   PUT    /api/lists/:id/items/order          - session - items of THIS
//                                                list only, all-or-nothing;
//                                                writes sort_order (document
//                                                order)
//   PUT    /api/lists/:id/items/pack-order     - session - items of THIS
//                                                list only, all-or-nothing;
//                                                writes pack_sort_order. 400
//                                                on a payload spanning two
//                                                cohorts, not a permutation of
//                                                current ranks, or naming a
//                                                worn row; 409 when a
//                                                concurrent reorder won
//   POST   /api/lists/:id/items/reset-packed   - session - own list or 404
//   POST   /api/lists/:id/items/reset-ready    - session - own list or 404
//   PATCH  /api/lists/:id/items/:itemId        - session - item must belong
//                                                to THIS list (parent-path)
//   DELETE /api/lists/:id/items/:itemId        - session - item must belong
//                                                to THIS list (parent-path)
// Session-gated by the hoisted api.use('/lists/*', requireSession) in
// server/index.ts - one lookup for all three sub-apps on this mount.
export const listRoutes = new Hono<{
  Bindings: AppDeps
  Variables: SessionVars
}>()

function toListResponse(row: ListRow): ListResponse {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    slug: row.slug,
    isShared: row.isShared,
    isDraft: row.isDraft,
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
    packSortOrder: row.item.packSortOrder,
    createdAt: new Date(row.item.createdAt).toISOString(),
    updatedAt: new Date(row.item.updatedAt).toISOString(),
    gearItem: toGearItemResponse(row.gear),
  }
}

// One place for the item-write failure map so every route agrees on
// statuses and wording. Exported for a direct unit test: the conflict branch
// exists for a race that cannot be staged through the HTTP surface, so the
// mapping is pinned here and the repo's conversion is pinned in its own test.
export function listItemFailure(
  result: Extract<ListItemWriteResult, { ok: false }>,
): {
  status: 400 | 404 | 409 | 422
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
      return { status: 422, error: LIMIT_REACHED.gearItem }
    case 'cap_exceeded':
      return { status: 422, error: LIMIT_REACHED.listItem }
    case 'pack_rank_exhausted':
      // Deliberately does NOT tell the user to reorder. An ordinary drag
      // permutes the ranks a cohort already holds, so it cannot compact
      // anything - it would write the same exhausted values back. (The
      // client's dense renumber runs only when it detects a cross-table tie,
      // not on exhaustion.)
      // Migration 0019 normalizes existing dirty cohorts, so reaching this
      // needs roughly a billion arrivals; there is no self-service fix and
      // pretending otherwise would send people in circles.
      return {
        status: 422,
        error: 'This packing group has run out of ordering space. Move some items to another group.',
      }
  }
}


// The list-write counterpart of listItemFailure above: the four list writes
// used to re-type near-identical if-chains. Exhaustive on purpose - a new
// repo reason fails the build here instead of falling through to a wrong
// default status.
function listWriteFailure(
  result:
    | Extract<ListWriteResult, { ok: false }>
    | Extract<DuplicateListResult, { ok: false }>
    | Extract<FromSelectionResult, { ok: false }>
    | Extract<ImportListResult, { ok: false }>,
): { status: 400 | 404 | 422; error: string } {
  switch (result.reason) {
    case 'not_found':
      return { status: 404, error: 'Not found' }
    case 'invalid_gear':
      return { status: 400, error: 'Invalid gear item' }
    case 'invalid_category':
      return { status: 400, error: 'Invalid category' }
    case 'cap_exceeded':
      return { status: 422, error: LIMIT_REACHED.list }
    case 'gear_cap_exceeded':
      return { status: 422, error: LIMIT_REACHED.gearItem }
    case 'item_cap_exceeded':
      return { status: 422, error: LIMIT_REACHED.listItem }
    case 'category_cap_exceeded':
      return { status: 422, error: LIMIT_REACHED.category }
  }
}

// --------------------------------------------------------------------- lists

listRoutes.get('/', async (c) => {
  const rows = await c.get('repos').lists.list()
  return c.json(rows.map(toListResponse))
})

listRoutes.post('/', async (c) => {
  const parsed = await parseBody(c, createListRequestSchema)
  if (!parsed.ok) return parsed.response
  const result = await c.get('repos').lists.create(parsed.data.name)
  if (!result.ok) {
    const f = listWriteFailure(result)
    return c.json({ error: f.error }, f.status)
  }
  return c.json(toListResponse(result.row), 201)
})

listRoutes.put('/order', async (c) => {
  const parsed = await parseBody(c, reorderListsRequestSchema)
  if (!parsed.ok) return parsed.response
  const ok = await c.get('repos').lists.reorder(parsed.data)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

listRoutes.post('/from-selection', async (c) => {
  const parsed = await parseBody(c, createListFromSelectionRequestSchema)
  if (!parsed.ok) return parsed.response
  const result = await c
    .get('repos')
    .lists.createFromSelection(
      parsed.data.name,
      parsed.data.description,
      parsed.data.gearItemIds,
    )
  if (!result.ok) {
    const f = listWriteFailure(result)
    return c.json({ error: f.error }, f.status)
  }
  return c.json(toListResponse(result.row), 201)
})

listRoutes.post('/import', async (c) => {
  const parsed = await parseBody(c, importListRequestSchema)
  if (!parsed.ok) return parsed.response
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
    const f = listWriteFailure(result)
    return c.json({ error: f.error }, f.status)
  }
  return c.json(toListResponse(result.row), 201)
})

listRoutes.post('/:id/duplicate', async (c) => {
  const result = await c.get('repos').lists.duplicate(c.req.param('id'))
  if (!result.ok) {
    const f = listWriteFailure(result)
    return c.json({ error: f.error }, f.status)
  }
  return c.json(toListResponse(result.row), 201)
})

listRoutes.patch('/:id', async (c) => {
  const parsed = await parseBody(c, updateListRequestSchema)
  if (!parsed.ok) return parsed.response
  const result = await c
    .get('repos')
    .lists.update(c.req.param('id'), parsed.data)
  if (!result.ok) return c.json({ error: 'Not found' }, 404)
  return c.json(toListResponse(result.row))
})

// Replaces the list's share link with a freshly minted one. No body: there is
// nothing to choose, the slug is server-minted like every other.
listRoutes.post('/:id/share-link', async (c) => {
  const result = await c.get('repos').lists.rotateShareLink(c.req.param('id'))
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
  const parsed = await parseBody(c, addListItemRequestSchema)
  if (!parsed.ok) return parsed.response
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
  const parsed = await parseBody(c, quickAddListItemRequestSchema)
  if (!parsed.ok) return parsed.response
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
  const parsed = await parseBody(c, reorderListItemsRequestSchema)
  if (!parsed.ok) return parsed.response
  const ok = await c
    .get('repos')
    .listItems.reorder(c.req.param('id'), parsed.data)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

// The Pack-view sibling of /items/order. Separate route rather than a scope
// flag on that one, because the payload shape differs (`packSortOrder`) and
// because "which column does this write" should be visible in the URL rather
// than buried in a body field.
listRoutes.put('/:id/items/pack-order', async (c) => {
  const parsed = await parseBody(c, reorderPackListItemsRequestSchema)
  if (!parsed.ok) return parsed.response
  // Gear and food halves are written in one transaction.
  const result = await c.get('repos').packReorder.reorder(c.req.param('id'), {
    items: parsed.data.items ?? [],
    foodItems: parsed.data.foodItems ?? [],
  })
  if (result.ok) return c.body(null, 204)
  // An id that is not on this list (or not this user's) is indistinguishable
  // from a list that does not exist, deliberately - the same 404 either way,
  // so the response never confirms that someone else's item id is real.
  if (result.reason === 'not_found') return c.json({ error: 'Not found' }, 404)
  return c.json({ error: 'Invalid request body' }, 400)
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
  const parsed = await parseBody(c, updateListItemRequestSchema)
  if (!parsed.ok) return parsed.response
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
