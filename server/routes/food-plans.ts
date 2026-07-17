import { Hono } from 'hono'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  addDayMealRequestSchema,
  addEntryRequestSchema,
  addMealRequestSchema,
  createFoodPlanRequestSchema,
  duplicateFoodPlanRequestSchema,
  renameFoodPlanRequestSchema,
  updateEntryRequestSchema,
  type FoodPlanDocument,
  type FoodPlanSummary,
} from '../../shared/food-plans'
import { requireSession, type SessionVars } from '../middleware/session'
import type {
  FoodPlanDocumentRow,
  PlanDocResult,
  PlanSummaryRow,
} from '../repos/food-plans'

// Authz matrix rows (docs/authz-matrix.md): every route is session-only and
// touches the caller's own plans exclusively (repo methods are userId-bound; the
// composite FKs make a cross-owner write impossible). Food-plan data is NEVER
// anon-reachable - the sole public food datum is the share's { weightGrams,
// incomplete } object (slice 5), not this table.
export const foodPlanRoutes = new Hono<{
  Bindings: Env
  Variables: SessionVars
}>()

foodPlanRoutes.use('*', requireSession)

function toSummary(row: PlanSummaryRow): FoodPlanSummary {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    dayCount: row.dayCount,
    entryCount: row.entryCount,
    usedByListId: row.usedByListId,
    usedByListName: row.usedByListName,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }
}

// Child collections are already DTO-shaped in the repo rows; only the plan-level
// epoch-ms timestamps need converting to ISO.
function toDocument(doc: FoodPlanDocumentRow): FoodPlanDocument {
  return {
    id: doc.id,
    name: doc.name,
    sortOrder: doc.sortOrder,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
    meals: doc.meals,
    days: doc.days,
    dayMeals: doc.dayMeals,
    entries: doc.entries,
    usedByLists: doc.usedByLists,
  }
}

// Map a mutation result to a response. capMessage names the specific cap so the
// UI can show which limit was hit. successStatus is 201 for creates, 200 for
// edits.
function respond(
  c: Context,
  result: PlanDocResult,
  capMessage: string,
  successStatus: ContentfulStatusCode = 200,
) {
  if (result.ok) return c.json(toDocument(result.doc), successStatus)
  switch (result.reason) {
    case 'not_found':
      return c.json({ error: 'Not found' }, 404)
    case 'invalid_ref':
      return c.json({ error: 'Invalid reference' }, 422)
    case 'duplicate':
      return c.json({ error: 'That food is already here' }, 409)
    case 'cap_exceeded':
      return c.json({ error: capMessage }, 422)
  }
}

// -------------------------------------------------------------------- plans

foodPlanRoutes.get('/', async (c) => {
  const rows = await c.get('repos').foodPlans.listSummaries()
  return c.json(rows.map(toSummary))
})

foodPlanRoutes.post('/', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = createFoodPlanRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const result = await c
    .get('repos')
    .foodPlans.create(parsed.data.name, parsed.data.days)
  return respond(c, result, 'Food plan limit reached (100 per user)', 201)
})

foodPlanRoutes.get('/:id', async (c) => {
  const doc = await c.get('repos').foodPlans.getDocument(c.req.param('id'))
  if (!doc) return c.json({ error: 'Not found' }, 404)
  return c.json(toDocument(doc))
})

foodPlanRoutes.patch('/:id', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = renameFoodPlanRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const result = await c
    .get('repos')
    .foodPlans.rename(c.req.param('id'), parsed.data.name)
  return respond(c, result, '')
})

foodPlanRoutes.delete('/:id', async (c) => {
  const ok = await c.get('repos').foodPlans.remove(c.req.param('id'))
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

// Duplicate (design 3.1). The body is OPTIONAL: no body / an empty body is a
// plain library duplicate; listId is "Duplicate & attach" (copy + attach in
// one transaction, the attach a CAS on expectedFoodPlanId - see the DTO).
// Only a genuinely ABSENT body falls through to the schema's defaults -
// malformed JSON stays a 400, because a request that garbled its listId must
// not silently become the other, list-less mutation.
foodPlanRoutes.post('/:id/duplicate', async (c) => {
  const text = await c.req.text()
  let raw: unknown = {}
  if (text.trim() !== '') {
    try {
      raw = JSON.parse(text)
    } catch {
      return c.json({ error: 'Invalid request body' }, 400)
    }
  }
  const parsed = duplicateFoodPlanRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const result = await c
    .get('repos')
    .foodPlans.duplicate(
      c.req.param('id'),
      parsed.data.listId,
      parsed.data.expectedFoodPlanId,
    )
  return respond(c, result, 'Food plan limit reached (100 per user)', 201)
})

// --------------------------------------------------------------------- days

foodPlanRoutes.post('/:id/days', async (c) => {
  const result = await c.get('repos').foodPlans.addDay(c.req.param('id'))
  return respond(c, result, 'Day limit reached (60 per plan)', 201)
})

foodPlanRoutes.delete('/:id/days/:dayId', async (c) => {
  const result = await c
    .get('repos')
    .foodPlans.removeDay(c.req.param('id'), c.req.param('dayId'))
  return respond(c, result, '')
})

// -------------------------------------------------------------------- meals

foodPlanRoutes.post('/:id/meals', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = addMealRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const result = await c
    .get('repos')
    .foodPlans.addMeal(c.req.param('id'), parsed.data.name)
  return respond(c, result, 'Meal limit reached (20 per plan)', 201)
})

foodPlanRoutes.delete('/:id/meals/:mealId', async (c) => {
  const result = await c
    .get('repos')
    .foodPlans.removeMeal(c.req.param('id'), c.req.param('mealId'))
  return respond(c, result, '')
})

// --------------------------------------------------------------- day_meals

foodPlanRoutes.post('/:id/day-meals', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = addDayMealRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const result = await c
    .get('repos')
    .foodPlans.addDayMeal(c.req.param('id'), parsed.data.dayId, parsed.data.mealId)
  return respond(c, result, '', 201)
})

foodPlanRoutes.delete('/:id/day-meals/:dayMealId', async (c) => {
  const result = await c
    .get('repos')
    .foodPlans.removeDayMeal(c.req.param('id'), c.req.param('dayMealId'))
  return respond(c, result, '')
})

// ------------------------------------------------------------------ entries

foodPlanRoutes.post('/:id/entries', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = addEntryRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const result = await c.get('repos').foodPlans.addEntry(c.req.param('id'), {
    dayMealId: parsed.data.dayMealId,
    isExtra: parsed.data.isExtra,
    foodItemId: parsed.data.foodItemId,
    basis: parsed.data.basis,
    amount: parsed.data.amount,
  })
  return respond(c, result, 'Entry limit reached (2000 per plan)', 201)
})

foodPlanRoutes.patch('/:id/entries/:entryId', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = updateEntryRequestSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
  const result = await c
    .get('repos')
    .foodPlans.updateEntry(c.req.param('id'), c.req.param('entryId'), {
      basis: parsed.data.basis,
      amount: parsed.data.amount,
    })
  return respond(c, result, '')
})

foodPlanRoutes.delete('/:id/entries/:entryId', async (c) => {
  const result = await c
    .get('repos')
    .foodPlans.removeEntry(c.req.param('id'), c.req.param('entryId'))
  return respond(c, result, '')
})
