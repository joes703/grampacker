import { Hono } from 'hono'
import { parseBody } from './parse-body'
import {
  PACKING_LOCATION_CAP,
  createPackingLocationRequestSchema,
  reorderPackingLocationsRequestSchema,
  updatePackingLocationRequestSchema,
  type PackingLocationResponse,
} from '../../shared/lists'
import { type SessionVars } from '../middleware/session'
import type { PackingLocationRow } from '../repos/packing-locations'
import type { AppEnv } from '../env'

export const packingLocationRoutes = new Hono<{
  Bindings: AppEnv
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
    if (result.reason === 'list_not_found') {
      return c.json({ error: 'Not found' }, 404)
    }
    if (result.reason === 'cap_exceeded') {
      return c.json(
        { error: `Packing location limit reached (${PACKING_LOCATION_CAP} per list)` },
        422,
      )
    }
    if (result.reason === 'already_container') {
      return c.json({ error: 'Item is already a container' }, 409)
    }
    return c.json({ error: 'Invalid container item' }, 400)
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
      if (result.reason === 'item_backed') {
        return c.json({ error: 'Item-backed locations use the item name' }, 409)
      }
      return c.json({ error: 'Not found' }, 404)
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
    if (result === 'not_found') return c.json({ error: 'Not found' }, 404)
    // The orphans are appended above the Unassigned maximum, so a cohort near
    // the top of the rank space has nowhere to put them. 0019 normalizes any
    // legacy cohort without headroom, so this is effectively unreachable - but
    // a 500 on an ordinary delete would be a poor way to find out otherwise.
    if (result === 'pack_rank_exhausted') {
      return c.json(
        {
          error:
            'This list has run out of pack ordering space. Move some items out of Unassigned first.',
        },
        422,
      )
    }
    // The unique index refused the write. No longer reachable by a concurrent
    // move or reorder (the repo works in one transaction); kept as the
    // backstop. Everything rolled back; retry after a refetch.
    if (result === 'conflict') {
      return c.json({ error: 'This list changed while deleting. Try again.' }, 409)
    }
    return c.body(null, 204)
  },
)
