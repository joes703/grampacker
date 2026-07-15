import { Hono } from 'hono'
import {
  createFoodItemRequestSchema,
  updateFoodItemRequestSchema,
  type CreateFoodItemRequest,
  type FoodItemResponse,
  type UpdateFoodItemRequest,
} from '../../shared/food'
import { requireSession, type SessionVars } from '../middleware/session'
import type {
  CreateFoodItemInput,
  FoodItemRow,
  UpdateFoodItemPatch,
} from '../repos/food-items'

// Authz matrix rows (docs/authz-matrix.md):
//   GET    /api/food-items     - session - own rows only
//   POST   /api/food-items     - session - creates own row; 422 at the cap
//   PATCH  /api/food-items/:id - session - own row or 404
//   DELETE /api/food-items/:id - session - own row or 404
//
// Food is session-only and NEVER anon-reachable. The sole anon-reachable
// food data in the whole system is the share's { weightGrams, incomplete }
// object (slice 5), through the existing share projection - not this table.
export const foodItemRoutes = new Hono<{
  Bindings: Env
  Variables: SessionVars
}>()

foodItemRoutes.use('*', requireSession)

function toFoodItemResponse(row: FoodItemRow): FoodItemResponse {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    servingDescription: row.servingDescription,
    servingWeightGrams: row.servingWeightGrams,
    caloriesPerServing: row.caloriesPerServing,
    servingsPerPackage: row.servingsPerPackage,
    fatGrams: row.fatGrams,
    saturatedFatGrams: row.saturatedFatGrams,
    carbsGrams: row.carbsGrams,
    fiberGrams: row.fiberGrams,
    sugarGrams: row.sugarGrams,
    proteinGrams: row.proteinGrams,
    sodiumMg: row.sodiumMg,
    potassiumMg: row.potassiumMg,
    notes: row.notes,
    sortOrder: row.sortOrder,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }
}

function toCreateInput(body: CreateFoodItemRequest): CreateFoodItemInput {
  return {
    name: body.name,
    brand: body.brand,
    servingDescription: body.servingDescription,
    servingWeightGrams: body.servingWeightGrams,
    caloriesPerServing: body.caloriesPerServing,
    servingsPerPackage: body.servingsPerPackage,
    fatGrams: body.fatGrams,
    saturatedFatGrams: body.saturatedFatGrams,
    carbsGrams: body.carbsGrams,
    fiberGrams: body.fiberGrams,
    sugarGrams: body.sugarGrams,
    proteinGrams: body.proteinGrams,
    sodiumMg: body.sodiumMg,
    potassiumMg: body.potassiumMg,
    notes: body.notes,
  }
}

function toUpdatePatch(body: UpdateFoodItemRequest): UpdateFoodItemPatch {
  const patch: UpdateFoodItemPatch = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.brand !== undefined) patch.brand = body.brand
  if (body.servingDescription !== undefined)
    patch.servingDescription = body.servingDescription
  if (body.servingWeightGrams !== undefined)
    patch.servingWeightGrams = body.servingWeightGrams
  if (body.caloriesPerServing !== undefined)
    patch.caloriesPerServing = body.caloriesPerServing
  if (body.servingsPerPackage !== undefined)
    patch.servingsPerPackage = body.servingsPerPackage
  if (body.fatGrams !== undefined) patch.fatGrams = body.fatGrams
  if (body.saturatedFatGrams !== undefined)
    patch.saturatedFatGrams = body.saturatedFatGrams
  if (body.carbsGrams !== undefined) patch.carbsGrams = body.carbsGrams
  if (body.fiberGrams !== undefined) patch.fiberGrams = body.fiberGrams
  if (body.sugarGrams !== undefined) patch.sugarGrams = body.sugarGrams
  if (body.proteinGrams !== undefined) patch.proteinGrams = body.proteinGrams
  if (body.sodiumMg !== undefined) patch.sodiumMg = body.sodiumMg
  if (body.potassiumMg !== undefined) patch.potassiumMg = body.potassiumMg
  if (body.notes !== undefined) patch.notes = body.notes
  return patch
}

foodItemRoutes.get('/', async (c) => {
  const rows = await c.get('repos').foodItems.list()
  return c.json(rows.map(toFoodItemResponse))
})

foodItemRoutes.post('/', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = createFoodItemRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const result = await c
    .get('repos')
    .foodItems.create(toCreateInput(parsed.data))
  if (!result.ok) {
    return c.json({ error: 'Food item limit reached (1000 per user)' }, 422)
  }
  return c.json(toFoodItemResponse(result.row), 201)
})

foodItemRoutes.patch('/:id', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = updateFoodItemRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const result = await c
    .get('repos')
    .foodItems.update(c.req.param('id'), toUpdatePatch(parsed.data))
  if (!result.ok) {
    return c.json({ error: 'Not found' }, 404)
  }
  return c.json(toFoodItemResponse(result.row))
})

foodItemRoutes.delete('/:id', async (c) => {
  const ok = await c.get('repos').foodItems.remove(c.req.param('id'))
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})
