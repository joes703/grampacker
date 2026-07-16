import { z } from 'zod'

// DTO contracts for /api/food-plans (food-planning-design.md slice 2). Response
// schemas are the allowlist: fields not named here never leave the server
// (user_id in particular - the client is always self). Canonical-vs-display:
// the DB stores epoch-ms integers; DTOs speak ISO strings. Grams/servings/kcal
// are the same number on both sides.
//
// Mirrors the shape discipline of shared/food.ts. A food plan is standalone and
// reusable; a gear list may point AT one in slice 3. This file covers the plan
// graph (plan + meals + days + day_meals + entries); the pure weight projection
// lives in shared/food-projection.ts (slice 2b).

// Per-plan and per-user caps. The authoritative enforcement is the set of DB
// triggers in migration 0008; these constants mirror them for client preflight
// and the repo's friendly-422 mapping. Third site to keep in lockstep: each
// trigger's RAISE message. Names match the old repo (see the TRANSPLANT NOTE in
// src/lib/caps.ts).
export const FOOD_PLAN_CAP = 100
export const FOOD_PLAN_DAY_CAP = 60
export const MEAL_DEFINITION_CAP = 20
export const FOOD_PLAN_ENTRY_CAP = 2000

// A text field must contain no NUL byte (SQLite length() stops at the first NUL,
// so a leading-NUL name passes zod min(1) but fails the DB CHECK as a 500 rather
// than a 400). Same guard as shared/food.ts.
const noNulByte = (s: string) => !s.includes('\u0000')
const noNulMsg = { message: 'must not contain a null byte' }

const planNameSchema = z.string().trim().min(1).max(256).refine(noNulByte, noNulMsg)
const mealNameSchema = z.string().trim().min(1).max(128).refine(noNulByte, noNulMsg)

// Opaque row ids (UUIDs are 36 chars; DB-minted ones are shorter). Bounding the
// length keeps a junk id a clean 400 instead of a wasted ownership query - and
// backstops against a future body-limit change letting an oversized bound value
// reach D1's 2 MB string ceiling as a 500. 100 is generous headroom.
const idSchema = z.string().min(1).max(100)

// The projection formula picker (design 5.1). Not a DB enum - a text column with
// a CHECK - but the wire contract is exactly these three.
export const foodPlanBasisSchema = z.enum(['servings', 'packages', 'weight'])
export type FoodPlanBasis = z.infer<typeof foodPlanBasisSchema>

// Entry amount. numeric(12,3) in the old build; here REAL with a > 0 CHECK. The
// round-trip refine (not an epsilon) pins <= 3 decimal places, matching the
// serving-weight scale so amount * serving_weight_grams cannot exceed the DB's
// precision. Same round-trip rationale as shared/food.ts decimalNumber.
const amountSchema = z
  .number()
  .gt(0)
  .max(9_999_999.999)
  .refine((v) => Math.round(v * 1000) / 1000 === v, {
    message: 'at most 3 decimal places',
  })

// ------------------------------------------------------------------ responses

// The Plans index card. dayCount is the headline ("3-day plan"); entryCount
// distinguishes an empty plan from a populated one. Both are cheap aggregates.
export const foodPlanSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  dayCount: z.number().int(),
  entryCount: z.number().int(),
  createdAt: z.string(), // ISO
  updatedAt: z.string(),
})
export type FoodPlanSummary = z.infer<typeof foodPlanSummarySchema>

export const mealSchema = z.object({
  id: z.string(),
  name: z.string(),
  anchorRole: z.enum(['breakfast', 'dinner']).nullable(),
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
})
export type Meal = z.infer<typeof mealSchema>

export const foodPlanDaySchema = z.object({
  id: z.string(),
  dayTypeOverride: z.enum(['full', 'partial']).nullable(),
  sortOrder: z.number().int(),
})
export type FoodPlanDay = z.infer<typeof foodPlanDaySchema>

export const dayMealSchema = z.object({
  id: z.string(),
  dayId: z.string(),
  mealId: z.string(),
})
export type DayMeal = z.infer<typeof dayMealSchema>

// An entry references a cell (dayMealId) OR Extras (isExtra, dayMealId null).
// It carries only the food reference + basis + amount; the editor joins to its
// own ['food-items'] cache for nutrition (the server-side projection that joins
// entries to food_items is slice 3). foodItemId always resolves: the food FK
// cascades, so a deleted food takes its entries with it.
export const foodPlanEntrySchema = z.object({
  id: z.string(),
  dayMealId: z.string().nullable(),
  isExtra: z.boolean(),
  foodItemId: z.string(),
  basis: foodPlanBasisSchema,
  amount: z.number(),
  sortOrder: z.number().int(),
})
export type FoodPlanEntry = z.infer<typeof foodPlanEntrySchema>

// A list this plan currently backs. Rides on the document (not a separate
// endpoint) so the editor's shared-plan warning (design 12.9) can never be
// stale relative to the plan it is warning about: every mutation returns the
// fresh document, and this comes with it.
export const foodPlanUsedBySchema = z.object({
  id: z.string(),
  name: z.string(),
})
export type FoodPlanUsedBy = z.infer<typeof foodPlanUsedBySchema>

// The whole plan graph in one batched read (design 5.2). Every structural
// mutation returns the fresh document so the editor stays a pure projection of
// this single cache entry (no fine-grained optimistic fan-out; design 5.5).
export const foodPlanDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  meals: mealSchema.array(),
  days: foodPlanDaySchema.array(),
  dayMeals: dayMealSchema.array(),
  entries: foodPlanEntrySchema.array(),
  usedByLists: foodPlanUsedBySchema.array(),
})
export type FoodPlanDocument = z.infer<typeof foodPlanDocumentSchema>

// ------------------------------------------------------------------- requests

// Create seeds server-side: the plan + 3 default meals (Breakfast / On-trail
// food / Dinner) + `days` day rows + a full day x meal grid. days defaults to 3,
// clamped to the day cap.
export const createFoodPlanRequestSchema = z
  .object({
    name: planNameSchema,
    days: z.number().int().min(1).max(FOOD_PLAN_DAY_CAP).default(3),
  })
  .strict()
export type CreateFoodPlanRequest = z.infer<typeof createFoodPlanRequestSchema>
export type CreateFoodPlanRequestInput = z.input<
  typeof createFoodPlanRequestSchema
>

export const renameFoodPlanRequestSchema = z
  .object({ name: planNameSchema })
  .strict()
export type RenameFoodPlanRequest = z.infer<typeof renameFoodPlanRequestSchema>

export const addMealRequestSchema = z.object({ name: mealNameSchema }).strict()
export type AddMealRequest = z.infer<typeof addMealRequestSchema>

// Schedule a (day, meal) cell. Both ids must belong to the same plan; the repo
// checks ownership and the composite FKs pin them to the plan structurally.
export const addDayMealRequestSchema = z
  .object({
    dayId: idSchema,
    mealId: idSchema,
  })
  .strict()
export type AddDayMealRequest = z.infer<typeof addDayMealRequestSchema>

// Add a food to a cell OR to Extras - exactly one. The refine mirrors the DB's
// entry_location_xor CHECK so a malformed target is a clean 400, not a 500.
export const addEntryRequestSchema = z
  .object({
    dayMealId: idSchema.nullable().default(null),
    isExtra: z.boolean().default(false),
    foodItemId: idSchema,
    basis: foodPlanBasisSchema,
    amount: amountSchema,
  })
  .strict()
  .refine(
    (v) =>
      (v.isExtra && v.dayMealId === null) ||
      (!v.isExtra && v.dayMealId !== null),
    { message: 'entry must target exactly one of a cell or Extras' },
  )
export type AddEntryRequest = z.infer<typeof addEntryRequestSchema>
export type AddEntryRequestInput = z.input<typeof addEntryRequestSchema>

// Fork a plan (design 3.1/12.9). listId is the trip the user arrived from:
// when present, the copy is attached to that list in the same transaction as
// the copy itself - "Duplicate for this trip" must never half-happen. Absent
// (null), it is a plain library duplicate and no list moves.
export const duplicateFoodPlanRequestSchema = z
  .object({
    listId: idSchema.nullable().default(null),
  })
  .strict()
export type DuplicateFoodPlanRequest = z.infer<
  typeof duplicateFoodPlanRequestSchema
>

export const updateEntryRequestSchema = z
  .object({
    basis: foodPlanBasisSchema.optional(),
    amount: amountSchema.optional(),
  })
  .strict()
  .refine((v) => v.basis !== undefined || v.amount !== undefined, {
    message: 'empty patch',
  })
export type UpdateEntryRequest = z.infer<typeof updateEntryRequestSchema>
