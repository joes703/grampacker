import { Hono } from 'hono'
import {
  createFoodItemRequestSchema,
  setFoodDaysRequestSchema,
  updateFoodItemRequestSchema,
  updateFoodSlotRequestSchema,
  type ListFoodResponse,
} from '../../shared/food'
import { requireSession, type SessionVars } from '../middleware/session'

// The food estimate on one list. Everything here is nested under a list id, and
// EVERY handler passes that id to the repo - the child id alone is never enough
// to say which list a slot or item belongs to, and trusting it would let one of
// the caller's own lists reach into another's rows.
//
// Session-scoped throughout. Nothing here is ever served anonymously: food is a
// private planning aid and does not appear in the public share projection.

export const foodRoutes = new Hono<{
  Bindings: Env
  Variables: SessionVars
}>()

foodRoutes.use('*', requireSession)

foodRoutes.get('/:id/food', async (c) => {
  const food = await c.get('repos').food.forList(c.req.param('id'))
  if (!food) return c.json({ error: 'Not found' }, 404)
  return c.json(food satisfies ListFoodResponse)
})

foodRoutes.put('/:id/food/days', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = setFoodDaysRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request' }, 400)

  const ok = await c
    .get('repos')
    .food.setDayCount(c.req.param('id'), parsed.data.days)
  if (!ok) return c.json({ error: 'Not found' }, 404)

  const food = await c.get('repos').food.forList(c.req.param('id'))
  return c.json(food satisfies ListFoodResponse | null)
})

foodRoutes.patch('/:id/food/slots/:slotId', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = updateFoodSlotRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request' }, 400)

  const ok = await c
    .get('repos')
    .food.setSlotNeeded(c.req.param('id'), c.req.param('slotId'), parsed.data.needed)
  if (!ok) return c.json({ error: 'Not found' }, 404)

  const food = await c.get('repos').food.forList(c.req.param('id'))
  return c.json(food satisfies ListFoodResponse | null)
})

foodRoutes.post('/:id/food/items', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = createFoodItemRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request' }, 400)

  const result = await c.get('repos').food.createItem(c.req.param('id'), parsed.data)
  if (!result.ok) {
    if (result.reason === 'not_found') return c.json({ error: 'Not found' }, 404)
    if (result.reason === 'cap_exceeded') {
      return c.json({ error: 'Food item limit reached (200 per list)' }, 422)
    }
    // A slot id that is not on this list, not this user's, or already marked
    // not-needed. Rejecting beats silently dropping the placement.
    return c.json({ error: 'Invalid slots' }, 400)
  }
  return c.json(result.row, 201)
})

foodRoutes.patch('/:id/food/items/:itemId', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = updateFoodItemRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request' }, 400)

  const result = await c
    .get('repos')
    .food.updateItem(c.req.param('id'), c.req.param('itemId'), parsed.data)
  if (!result.ok) {
    if (result.reason === 'invalid_slots') return c.json({ error: 'Invalid slots' }, 400)
    return c.json({ error: 'Not found' }, 404)
  }
  return c.json(result.row)
})

foodRoutes.delete('/:id/food/items/:itemId', async (c) => {
  const ok = await c
    .get('repos')
    .food.deleteItem(c.req.param('id'), c.req.param('itemId'))
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})
