import { Hono } from 'hono'
import {
  createPackingLocationRequestSchema,
  reorderPackingLocationsRequestSchema,
  updatePackingLocationRequestSchema,
  type PackingLocationResponse,
} from '../../shared/lists'
import { type SessionVars } from '../middleware/session'
import type { PackingLocationRow } from '../repos/packing-locations'

export const packingLocationRoutes = new Hono<{
  Bindings: Env
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
  const raw = await c.req.json().catch(() => null)
  const parsed = createPackingLocationRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const result = await c
    .get('repos')
    .packingLocations.create(c.req.param('id'), parsed.data)
  if (!result.ok) {
    if (result.reason === 'list_not_found') {
      return c.json({ error: 'Not found' }, 404)
    }
    if (result.reason === 'cap_exceeded') {
      return c.json(
        { error: 'Packing location limit reached (30 per list)' },
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
  const raw = await c.req.json().catch(() => null)
  const parsed = reorderPackingLocationsRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const ok = await c
    .get('repos')
    .packingLocations.reorder(c.req.param('id'), parsed.data)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

packingLocationRoutes.patch(
  '/:id/packing-locations/:locationId',
  async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = updatePackingLocationRequestSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
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
    return c.body(null, 204)
  },
)
