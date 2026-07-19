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
// usedByList*: the list this plan backs, if any - at most one exists (a plan
// is per-trip; lists_food_plan_id_unique enforces it), and naming it here is
// what lets the picker show "In use by <list>" and offer Duplicate & attach
// without a second query.
export const foodPlanSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  dayCount: z.number().int(),
  entryCount: z.number().int(),
  usedByListId: z.string().nullable(),
  usedByListName: z.string().nullable(),
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

// The list this plan currently backs (at most one - a plan is per-trip; null
// when free). Rides on the document (not a separate endpoint) so the editor's
// "Used by <list>" breadcrumb can never be stale relative to the plan it
// describes: every mutation returns the fresh document, and this comes with it.
export const foodPlanUsedBySchema = z.object({
  id: z.string(),
  name: z.string(),
})
export type FoodPlanUsedBy = z.infer<typeof foodPlanUsedBySchema>

// ------------------------------------------------------------------- targets

// Nutrition targets (slice 7). `mode` NEVER includes 'off' on the wire or in
// the DB: "off" is the absence of the row (a deliberate tightening of the old
// build, where plan tables could store an off row the client never wrote).
export const DAILY_TARGET_METRICS = [
  'calories',
  'protein',
  'carbs',
  'fiber',
  'sodium',
  'calorie_density',
] as const
export const MEAL_TARGET_METRICS = [
  'calories',
  'protein',
  'fat_pct',
  'sugar_pct',
  'carb_protein_ratio',
] as const
export type DailyTargetMetric = (typeof DAILY_TARGET_METRICS)[number]
export type MealTargetMetric = (typeof MEAL_TARGET_METRICS)[number]

export const targetModeSchema = z.enum(['range', 'min', 'max'])
export type TargetMode = z.infer<typeof targetModeSchema>

export const foodPlanDailyTargetSchema = z.object({
  id: z.string(),
  metric: z.enum(DAILY_TARGET_METRICS),
  mode: targetModeSchema,
  targetMin: z.number().nullable(),
  targetMax: z.number().nullable(),
})
export type FoodPlanDailyTarget = z.infer<typeof foodPlanDailyTargetSchema>

export const mealTargetSchema = z.object({
  id: z.string(),
  mealId: z.string(),
  metric: z.enum(MEAL_TARGET_METRICS),
  mode: targetModeSchema,
  targetMin: z.number().nullable(),
  targetMax: z.number().nullable(),
})
export type MealTarget = z.infer<typeof mealTargetSchema>

// A target bound mirrors the old numeric(12,4): >= 0, < 1e8, at most 4
// decimal places (round-trip check, not epsilon - see shared/food.ts for why
// the epsilon form is magnitude-fragile). Magnitude is also a DB CHECK; the
// scale is zod-only, like every other REAL column.
const targetBoundSchema = z
  .number()
  .min(0)
  .lt(100_000_000)
  .refine((v) => Math.round(v * 10_000) / 10_000 === v, {
    message: 'at most 4 decimal places',
  })

// I-BOUNDS, exactly the DB CHECK's mode branches. Shared by the plan-targets
// and defaults request schemas so the mirrors cannot drift.
export function targetBoundsConsistent(t: {
  mode: TargetMode
  targetMin: number | null
  targetMax: number | null
}): boolean {
  switch (t.mode) {
    case 'min':
      return t.targetMin !== null && t.targetMax === null
    case 'max':
      return t.targetMax !== null && t.targetMin === null
    case 'range':
      return (
        t.targetMin !== null && t.targetMax !== null && t.targetMin <= t.targetMax
      )
  }
}
const boundsRefine = {
  message: 'bounds do not match mode',
} as const

export const dailyTargetInputSchema = z
  .object({
    metric: z.enum(DAILY_TARGET_METRICS),
    mode: targetModeSchema,
    targetMin: targetBoundSchema.nullable(),
    targetMax: targetBoundSchema.nullable(),
  })
  .strict()
  .refine(targetBoundsConsistent, boundsRefine)
export type DailyTargetInput = z.infer<typeof dailyTargetInputSchema>

export const mealTargetInputSchema = z
  .object({
    mealId: idSchema,
    metric: z.enum(MEAL_TARGET_METRICS),
    mode: targetModeSchema,
    targetMin: targetBoundSchema.nullable(),
    targetMax: targetBoundSchema.nullable(),
  })
  .strict()
  .refine(targetBoundsConsistent, boundsRefine)
  // I-PCT: percent metrics cap at 100 (mirrors meal_target_pct_ceiling).
  .refine(
    (t) =>
      (t.metric !== 'fat_pct' && t.metric !== 'sugar_pct') ||
      ((t.targetMin === null || t.targetMin <= 100) &&
        (t.targetMax === null || t.targetMax <= 100)),
    { message: 'percent targets cap at 100' },
  )
export type MealTargetInput = z.infer<typeof mealTargetInputSchema>

// FULL-replace save: the payload is the COMPLETE target set for the plan
// (design decision 1 - no diff, no contradiction guards; a metric absent
// from the payload is deleted, and "off" in the editor simply omits the
// row). Duplicate metrics / (mealId, metric) pairs are payload bugs, not
// mergeable intent, so they 400.
export const saveTargetsRequestSchema = z
  .object({
    daily: z.array(dailyTargetInputSchema).max(DAILY_TARGET_METRICS.length),
    meals: z
      .array(mealTargetInputSchema)
      .max(MEAL_DEFINITION_CAP * MEAL_TARGET_METRICS.length),
  })
  .strict()
  .superRefine((val, ctx) => {
    const metrics = new Set<string>()
    for (const t of val.daily) {
      if (metrics.has(t.metric)) {
        ctx.addIssue({
          code: 'custom',
          path: ['daily'],
          message: `duplicate daily metric: ${t.metric}`,
        })
      }
      metrics.add(t.metric)
    }
    const pairs = new Set<string>()
    for (const t of val.meals) {
      const key = `${t.mealId} ${t.metric}`
      if (pairs.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['meals'],
          message: `duplicate meal target: ${t.metric}`,
        })
      }
      pairs.add(key)
    }
  })
export type SaveTargetsRequest = z.infer<typeof saveTargetsRequestSchema>

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
  // Sorted by metric / (mealId, metric) for a stable wire shape; empty arrays
  // when no targets are set (never absent - takeout and the editor both key
  // off presence of the field, not presence of rows).
  dailyTargets: foodPlanDailyTargetSchema.array(),
  mealTargets: mealTargetSchema.array(),
  usedByList: foodPlanUsedBySchema.nullable(),
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

// Duplicate a plan (design 3.1). listId, when present, is a trip to attach
// the COPY to in the same transaction as the copy itself - "Duplicate &
// attach" must never half-happen; null is a plain library duplicate and no
// list moves. A caller sending listId MUST also send expectedFoodPlanId: the
// plan id it OBSERVED on that list (null = it saw none). The server's attach
// is a compare-and-swap on that value, so a concurrent attach/detach/
// duplicate that moved the link makes this fork lose cleanly (422, copy
// rolled back) instead of silently overwriting the newer link. The zod
// default null therefore fails safe: an omitted expectation only matches a
// list with no plan.
export const duplicateFoodPlanRequestSchema = z
  .object({
    listId: idSchema.nullable().default(null),
    expectedFoodPlanId: idSchema.nullable().default(null),
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
