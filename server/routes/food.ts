import { Hono } from 'hono'
import { LIMIT_REACHED } from './limit-messages'
import { parseBody } from './parse-body'
import {
  createFoodItemRequestSchema,
  setFoodDaysRequestSchema,
  updateFoodItemRequestSchema,
  type FoodItemResponse,
  type ListFoodResponse,
} from '../../shared/food'
import type { FoodItemRow } from '../repos/food'
import { type SessionVars } from '../middleware/session'
import type { AppDeps } from '../env'

// The food estimate on one list. Everything here is nested under a list id, and
// EVERY handler passes that id to the repo - the child id alone is never enough
// to say which list a slot or item belongs to, and trusting it would let one of
// the caller's own lists reach into another's rows.
//
// Session-scoped throughout: nothing on THESE routes is ever served
// anonymously. That is a statement about this module, not about food.
//
// It used to read "food ... does not appear in the public share projection",
// which stopped being true when the share began publishing food rows and was
// left standing. What the share publishes is a narrow projection built in
// server/routes/shares.ts - name, carried count, weight, order. What never
// leaves this module is the PLAN: the day grid, the meal slots, and every
// item's slot ids and pack state.


// The explicit allowlist between the repo row and the wire, like every
// sibling route: a field added to the row reaches the response only by
// being named here (server/repos/public-shares.ts states the philosophy).
function toFoodItemResponse(row: FoodItemRow): FoodItemResponse {
  return {
    id: row.id,
    name: row.name,
    weightGrams: row.weightGrams,
    quantity: row.quantity,
    isPerMeal: row.isPerMeal,
    unitCount: row.unitCount,
    sortOrder: row.sortOrder,
    isPacked: row.isPacked,
    isReady: row.isReady,
    packingLocationId: row.packingLocationId,
    packSortOrder: row.packSortOrder,
    slotIds: row.slotIds,
  }
}

export const foodRoutes = new Hono<{
  Bindings: AppDeps
  Variables: SessionVars
}>()


foodRoutes.get('/:id/food', async (c) => {
  const food = await c.get('repos').food.forList(c.req.param('id'))
  if (!food) return c.json({ error: 'Not found' }, 404)
  return c.json(food satisfies ListFoodResponse)
})

foodRoutes.put('/:id/food/days', async (c) => {
  const parsed = await parseBody(c, setFoodDaysRequestSchema)
  if (!parsed.ok) return parsed.response

  // The repo answers with the estimate read inside the same transaction as
  // the write, so the response is exactly what committed.
  const food = await c
    .get('repos')
    .food.setDayCount(c.req.param('id'), parsed.data.days)
  if (!food) return c.json({ error: 'Not found' }, 404)
  return c.json(food satisfies ListFoodResponse)
})

foodRoutes.post('/:id/food/items', async (c) => {
  const parsed = await parseBody(c, createFoodItemRequestSchema)
  if (!parsed.ok) return parsed.response

  const result = await c.get('repos').food.createItem(c.req.param('id'), parsed.data)
  if (!result.ok) {
    if (result.reason === 'not_found') return c.json({ error: 'Not found' }, 404)
    if (result.reason === 'cap_exceeded') {
      return c.json({ error: LIMIT_REACHED.foodItem }, 422)
    }
    if (result.reason === 'pack_rank_exhausted') {
      return c.json({ error: 'This bag cannot accept more items' }, 422)
    }
    // A slot id that is not on this list or not this user's. Rejecting beats
    // silently dropping the placement.
    return c.json({ error: 'Invalid slots' }, 400)
  }
  return c.json(toFoodItemResponse(result.row), 201)
})

foodRoutes.patch('/:id/food/items/:itemId', async (c) => {
  const parsed = await parseBody(c, updateFoodItemRequestSchema)
  if (!parsed.ok) return parsed.response

  const result = await c
    .get('repos')
    .food.updateItem(c.req.param('id'), c.req.param('itemId'), parsed.data)
  if (!result.ok) {
    if (result.reason === 'invalid_slots') return c.json({ error: 'Invalid slots' }, 400)
    // A location id that is not on this list or not this user's. Same
    // wording and status as the gear item PATCH uses for the same failure.
    if (result.reason === 'invalid_location') {
      return c.json({ error: 'Invalid packing location' }, 400)
    }
    if (result.reason === 'pack_rank_exhausted') {
      return c.json({ error: 'This bag cannot accept more items' }, 422)
    }
    return c.json({ error: 'Not found' }, 404)
  }
  return c.json(toFoodItemResponse(result.row))
})

foodRoutes.delete('/:id/food/items/:itemId', async (c) => {
  const ok = await c
    .get('repos')
    .food.deleteItem(c.req.param('id'), c.req.param('itemId'))
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})
