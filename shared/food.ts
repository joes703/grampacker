import { z } from 'zod'

// Same shape as the id guard in shared/lists.ts; kept local so this module
// has no dependency on the list DTOs.
const idSchema = z.string().min(1).max(64)

// Food estimate DTOs and limits, shared by client and server.
//
// This is NOT the old food domain. That was deleted in migration 0016 - ten
// tables, nutrition, targets, reusable plans, a library. This is a food WEIGHT
// ESTIMATE attached to one list, and it should stay this small.

// Trip length ceiling. Enforced by the day_number CHECK on list_food_slots
// rather than a row-count trigger: that table holds three rows per day, so a
// count-based cap of 30 would silently mean ten days. The SQL and Drizzle
// copies are checked by scripts/quantity-bounds.test.ts.
export const FOOD_DAY_CAP = 30

// Carried food entries per list. Trigger-enforced in migration 0017, mirroring
// the LIST_ITEM_CAP convention - keep in lockstep with the RAISE text.
export const FOOD_ITEM_CAP = 200

// n days x breakfast/lunch/dinner. Upper bound on how many slots a single
// association write may name.
export const FOOD_SLOT_CAP = FOOD_DAY_CAP * 3

export const MEALS = ['breakfast', 'lunch', 'dinner'] as const
export type Meal = (typeof MEALS)[number]

export const foodSlotResponseSchema = z.object({
  id: z.string(),
  dayNumber: z.number().int(),
  meal: z.enum(MEALS),
})
export type FoodSlotResponse = z.infer<typeof foodSlotResponseSchema>

export const foodItemResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  weightGrams: z.number(),
  // How many you eat AT ONE MEAL when isPerMeal, or the total when it is a
  // shared stash. Meaningless without isPerMeal beside it.
  quantity: z.number().int(),
  // 0024. Per-meal (the default) or a shared total. See foodUnitCount.
  isPerMeal: z.boolean(),
  // What you actually CARRY, computed by the server from quantity, isPerMeal
  // and the schedule. Sent rather than left to each caller because the public
  // share needs it and must never receive the schedule it derives from - and
  // because three surfaces computing it independently is how the share came
  // to report a lighter pack than the owner's own page once before.
  unitCount: z.number().int(),
  sortOrder: z.number().int(),
  // Pack state (0022): food is a full peer of gear in Pack mode. The rank is
  // a per-cohort rank in the UNION rank space shared with gear - see
  // server/repos/pack-reorder.ts.
  isPacked: z.boolean(),
  isReady: z.boolean(),
  packingLocationId: z.string().nullable(),
  packSortOrder: z.number().int(),
  slotIds: z.array(z.string()),
})
export type FoodItemResponse = z.infer<typeof foodItemResponseSchema>

export const listFoodResponseSchema = z.object({
  dayCount: z.number().int(),
  slots: z.array(foodSlotResponseSchema),
  items: z.array(foodItemResponseSchema),
})
export type ListFoodResponse = z.infer<typeof listFoodResponseSchema>

export const setFoodDaysRequestSchema = z
  .object({ days: z.number().int().min(0).max(FOOD_DAY_CAP) })
  .strict()
export type SetFoodDaysRequest = z.infer<typeof setFoodDaysRequestSchema>

// Bounded and de-duplicated at the boundary so a write can never name more
// slots than a trip can hold, and so the D1 param chunking downstream has a
// known ceiling to work against.
const slotIdsSchema = z
  .array(idSchema)
  .max(FOOD_SLOT_CAP)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'slotIds must be unique',
  })

export const foodNameSchema = z.string().trim().min(1).max(128)
export const foodWeightSchema = z.number().min(0).max(100000)
// The ceiling in ONE place for everything TypeScript can reach: the request
// schema below, the add form's validation and max attribute, and the carrying
// row's inline clamp. The DATABASE holds its own copy as a CHECK literal in
// shipped migration 0017 - SQL cannot import a constant - and
// scripts/quantity-bounds.test.ts is what keeps the two honest.
export const FOOD_QUANTITY_MAX = 9999
export const foodQuantitySchema = z.number().int().min(1).max(FOOD_QUANTITY_MAX)

export const createFoodItemRequestSchema = z
  .object({
    name: foodNameSchema,
    weightGrams: foodWeightSchema,
    quantity: foodQuantitySchema,
    // Omitted means per-meal, matching the column default. A client that has
    // not been taught about shared stashes still creates the common case.
    isPerMeal: z.boolean().optional(),
    slotIds: slotIdsSchema,
  })
  .strict()
export type CreateFoodItemRequest = z.infer<typeof createFoodItemRequestSchema>

// slotIds OMITTED means "leave the associations alone"; slotIds: [] means
// "unschedule this item". Those are different operations and the DTO has to
// keep them distinguishable.
export const updateFoodItemRequestSchema = z
  .object({
    name: foodNameSchema.optional(),
    weightGrams: foodWeightSchema.optional(),
    quantity: foodQuantitySchema.optional(),
    isPerMeal: z.boolean().optional(),
    slotIds: slotIdsSchema.optional(),
    // Pack state. packingLocationId null means Unassigned; omitted means
    // "leave the assignment alone" - the same absent-vs-null PATCH semantics
    // as everything else. packSortOrder is deliberately NOT patchable here:
    // ranks move only through the pack-order permutation endpoint.
    isPacked: z.boolean().optional(),
    isReady: z.boolean().optional(),
    packingLocationId: idSchema.nullable().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'at least one field is required',
  })
export type UpdateFoodItemRequest = z.infer<typeof updateFoodItemRequestSchema>


/**
 * What you CARRY of a food item: the one definition, imported by the server
 * that publishes it and by every test that checks it.
 *
 * Per-meal is the common case and the default - a packet in each of five
 * lunches is five packets. A SHARED stash ignores the schedule entirely: one
 * bag of trail mix picked at across five lunches is one bag, which is the case
 * the "scheduling never multiplies weight" contract exists to protect.
 *
 * An UNSCHEDULED per-meal item counts one meal's worth rather than zero.
 * Adding food before you have planned where it goes should not make it
 * weightless - it is in the pack either way, and the row already carries an
 * "Unscheduled" badge saying the plan is incomplete.
 */
export function foodUnitCount(item: {
  quantity: number
  isPerMeal: boolean
  slotIds: readonly string[]
}): number {
  if (!item.isPerMeal) return item.quantity
  return item.quantity * Math.max(item.slotIds.length, 1)
}
