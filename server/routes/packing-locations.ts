import { Hono } from 'hono'
import { LIMIT_REACHED } from './limit-messages'
import { parseBody } from './parse-body'
import {
  createPackingLocationRequestSchema,
  reorderPackingLocationsRequestSchema,
  updatePackingLocationRequestSchema,
  type PackingLocationResponse,
} from '../../shared/lists'
import { type SessionVars } from '../middleware/session'
import type {
  CreatePackingLocationResult,
  PackingLocationRow,
  RenamePackingLocationResult,
} from '../repos/packing-locations'
import type { AppDeps } from '../env'

// Authz matrix rows (docs/authz-matrix.md):
//   GET    /api/lists/:id/packing-locations           - session - own list or 404
//   POST   /api/lists/:id/packing-locations           - session - own list or 404;
//                                                       named location or item-backed
//                                                       container; 422 at the cap
//   PUT    /api/lists/:id/packing-locations/order     - session - every id on THIS
//                                                       list and user or 404, zero writes
//   PATCH  /api/lists/:id/packing-locations/:locationId - session - own row or 404;
//                                                       409 for item-backed (live gear
//                                                       name is authoritative)
//   DELETE /api/lists/:id/packing-locations/:locationId - session - own row or 404;
//                                                       returns contents to Unassigned
//
// Session-gated by the hoisted api.use('/lists/*', requireSession) in
// server/index.ts, shared with the other /lists sub-apps so one request pays
// the session lookup once. There is no visible gate in this file on purpose.
// Exhaustive on purpose, like the write-failure maps in lists.ts: a new repo
// reason fails the build here instead of falling through to a wrong default.
function createLocationFailure(
  result: Extract<CreatePackingLocationResult, { ok: false }>,
): { status: 400 | 404 | 409 | 422; error: string } {
  switch (result.reason) {
    case 'list_not_found':
      return { status: 404, error: 'Not found' }
    case 'cap_exceeded':
      return { status: 422, error: LIMIT_REACHED.packingLocation }
    case 'already_container':
      return { status: 409, error: 'Item is already a container' }
    case 'invalid_container_item':
      return { status: 400, error: 'Invalid container item' }
  }
}

function renameLocationFailure(
  result: Extract<RenamePackingLocationResult, { ok: false }>,
): { status: 404 | 409; error: string } {
  switch (result.reason) {
    case 'not_found':
      return { status: 404, error: 'Not found' }
    case 'item_backed':
      return { status: 409, error: 'Item-backed locations use the item name' }
  }
}

export const packingLocationRoutes = new Hono<{
  Bindings: AppDeps
  Variables: SessionVars
}>()

function toResponse(row: PackingLocationRow): PackingLocationResponse {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    containerListItemId: row.containerListItemId,
  }
}

packingLocationRoutes.get('/:id/packing-locations', async (c) => {
  const rows = await c
    .get('repos')
    .packingLocations.forList(c.req.param('id'))
  if (rows === null) return c.json({ error: 'Not found' }, 404)
  return c.json(rows.map(toResponse))
})

packingLocationRoutes.post('/:id/packing-locations', async (c) => {
  const parsed = await parseBody(c, createPackingLocationRequestSchema)
  if (!parsed.ok) return parsed.response
  const result = await c
    .get('repos')
    .packingLocations.create(c.req.param('id'), parsed.data)
  if (!result.ok) {
    const { status, error } = createLocationFailure(result)
    return c.json({ error }, status)
  }
  return c.json(toResponse(result.row), 201)
})

// Static /order is registered before /:locationId.
packingLocationRoutes.put('/:id/packing-locations/order', async (c) => {
  const parsed = await parseBody(c, reorderPackingLocationsRequestSchema)
  if (!parsed.ok) return parsed.response
  const ok = await c
    .get('repos')
    .packingLocations.reorder(c.req.param('id'), parsed.data)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

packingLocationRoutes.patch(
  '/:id/packing-locations/:locationId',
  async (c) => {
    const parsed = await parseBody(c, updatePackingLocationRequestSchema)
    if (!parsed.ok) return parsed.response
    const result = await c
      .get('repos')
      .packingLocations.rename(
        c.req.param('id'),
        c.req.param('locationId'),
        parsed.data.name,
      )
    if (!result.ok) {
      const { status, error } = renameLocationFailure(result)
      return c.json({ error }, status)
    }
    return c.json(toResponse(result.row))
  },
)

packingLocationRoutes.delete(
  '/:id/packing-locations/:locationId',
  async (c) => {
    const result = await c
      .get('repos')
      .packingLocations.remove(
        c.req.param('id'),
        c.req.param('locationId'),
      )
    // Every case returns, and noImplicitReturns is on, so a new result from
    // the repo fails the build here instead of answering 204.
    switch (result) {
      case 'deleted':
        return c.body(null, 204)
      case 'not_found':
        return c.json({ error: 'Not found' }, 404)
      // The orphans are appended above the Unassigned maximum, so a cohort
      // near the top of the rank space has nowhere to put them. This is
      // effectively unreachable (see isPackRankRangeError), but a 500 on an
      // ordinary delete would be a poor way to find out otherwise.
      case 'pack_rank_exhausted':
        return c.json(
          {
            error:
              'This list has run out of pack ordering space. Move some items out of Unassigned first.',
          },
          422,
        )
    }
  },
)
