import { z } from 'zod'

// DTO contracts for /api/food-items. Response schemas are the allowlist:
// fields not named here never leave the server (user_id in particular - the
// client is always self). Canonical-vs-display: the DB stores epoch-ms
// integers; DTOs speak ISO strings. Grams and kcal are the same number on
// both sides (no cents-style conversion).
//
// Mirrors shared/gear.ts. Fractional food numbers are IEEE-754 doubles end
// to end (food-planning-design.md 5.6/12.10): the projection carries full
// precision and rounds ONCE to integer grams at the boundary. These schemas
// mirror the DB CHECK bounds and add a decimal-place limit.

// Max foods in a user's library. The authoritative enforcement is the
// food_items_user_cap DB trigger (migrations/0007_food-items.sql); this
// constant mirrors it for client-side preflight and the repo's friendly-422
// mapping. Third site to keep in lockstep: the trigger's RAISE message.
export const FOOD_ITEM_CAP = 1000

// A text field must contain no NUL byte. SQLite's length() stops at the
// first NUL, so a name whose first character is NUL has JS length >= 1 but
// SQLite length 0: it passes zod's min(1) and then fails the DB's
// `length between 1 and 256` CHECK, surfacing as an unmapped 500 instead of a
// 400 (Codex finding). Rejecting it in the shared schema makes it a clean 400
// on both sides. A NUL in any text field is junk input regardless, so this
// applies to all of them.
const noNulByte = (s: string) => !s.includes('\u0000')
const noNulMsg = { message: 'must not contain a null byte' }

// Bounds mirror the old numeric(10,x) CHECKs; the DB re-enforces them.
const foodNameSchema = z.string().trim().min(1).max(256).refine(noNulByte, noNulMsg)
// Empty string is not valid - clients send null to clear (the gear
// descriptionSchema convention).
const brandSchema = z.string().trim().min(1).max(256).refine(noNulByte, noNulMsg)
const servingDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(noNulByte, noNulMsg)
const notesSchema = z.string().trim().min(1).max(2000).refine(noNulByte, noNulMsg)

// A fractional food number with a bounded number of decimal places. The
// refine rejects any value that is not exactly representable at `decimals`
// places, so the DB's numeric(10,d) precision can't be exceeded from the
// client. `decimals` is the numeric(10,d) scale.
//
// The check is `round(v*scale)/scale === v`, NOT the epsilon form
// `abs(v*scale - round(v*scale)) < 1e-6`. The epsilon form is magnitude-
// fragile: near the upper bound, v*scale loses so much precision that an
// 8-decimal value can land exactly on an integer and pass as "2 decimals"
// (Codex finding: 99999999.00999999 * 100 === 9999999901). Comparing the
// round-tripped value back to the original catches that. (gear's costSchema
// still uses the epsilon form; not touched here - different PR.)
function decimalNumber(opts: {
  min: number
  minExclusive?: boolean
  max: number
  decimals: number
}) {
  const scale = 10 ** opts.decimals
  let schema = z.number().max(opts.max)
  schema = opts.minExclusive ? schema.gt(opts.min) : schema.min(opts.min)
  return schema.refine((v) => Math.round(v * scale) / scale === v, {
    message: `at most ${opts.decimals} decimal places`,
  })
}

// numeric(10,3), strictly > 0: always projectable (design 5.4).
const servingWeightSchema = decimalNumber({
  min: 0,
  minExclusive: true,
  max: 9_999_999.999,
  decimals: 3,
})
// numeric(10,3), strictly > 0, nullable. A NULL here is the
// incomplete-projection signal, so "blank" (null) and "invalid" must never
// collapse together on the client (they do in the old parser; see the SPA
// dialog). > 0 excludes 0 as well.
const servingsPerPackageSchema = decimalNumber({
  min: 0,
  minExclusive: true,
  max: 9_999_999.999,
  decimals: 3,
})
// numeric(10,2), >= 0.
const caloriesSchema = decimalNumber({ min: 0, max: 99_999_999.99, decimals: 2 })
// numeric(10,2), >= 0 (macros in grams).
const macroGramsSchema = decimalNumber({
  min: 0,
  max: 99_999_999.99,
  decimals: 2,
})
// numeric(10,1), >= 0 (sodium / potassium in mg).
const milligramsSchema = decimalNumber({
  min: 0,
  max: 999_999_999.9,
  decimals: 1,
})

// ---------------------------------------------------------------- food items

export const foodItemResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  servingDescription: z.string().nullable(),
  servingWeightGrams: z.number(),
  caloriesPerServing: z.number(),
  servingsPerPackage: z.number().nullable(),
  fatGrams: z.number().nullable(),
  saturatedFatGrams: z.number().nullable(),
  carbsGrams: z.number().nullable(),
  fiberGrams: z.number().nullable(),
  sugarGrams: z.number().nullable(),
  proteinGrams: z.number().nullable(),
  sodiumMg: z.number().nullable(),
  potassiumMg: z.number().nullable(),
  notes: z.string().nullable(),
  sortOrder: z.number().int(),
  createdAt: z.string(), // ISO timestamp
  updatedAt: z.string(),
})
export type FoodItemResponse = z.infer<typeof foodItemResponseSchema>

export const createFoodItemRequestSchema = z
  .object({
    name: foodNameSchema,
    brand: brandSchema.nullable().default(null),
    servingDescription: servingDescriptionSchema.nullable().default(null),
    servingWeightGrams: servingWeightSchema,
    caloriesPerServing: caloriesSchema,
    servingsPerPackage: servingsPerPackageSchema.nullable().default(null),
    fatGrams: macroGramsSchema.nullable().default(null),
    saturatedFatGrams: macroGramsSchema.nullable().default(null),
    carbsGrams: macroGramsSchema.nullable().default(null),
    fiberGrams: macroGramsSchema.nullable().default(null),
    sugarGrams: macroGramsSchema.nullable().default(null),
    proteinGrams: macroGramsSchema.nullable().default(null),
    sodiumMg: milligramsSchema.nullable().default(null),
    potassiumMg: milligramsSchema.nullable().default(null),
    notes: notesSchema.nullable().default(null),
  })
  .strict()
export type CreateFoodItemRequest = z.infer<typeof createFoodItemRequestSchema>
// What a CLIENT passes: the defaults make everything but name / serving
// weight / calories optional on the way in.
export type CreateFoodItemRequestInput = z.input<
  typeof createFoodItemRequestSchema
>

// Bulk CSV import: every row is exactly a create request. max(2000) mirrors
// the client-side MAX_CSV_ROWS parse cap (src/lib/csv/core.ts) - the DTO cap
// exists so the bound can't be bypassed by hand-crafting a request.
export const importFoodRequestSchema = z
  .object({
    items: z.array(createFoodItemRequestSchema).min(1).max(2000),
  })
  .strict()
export type ImportFoodRequest = z.infer<typeof importFoodRequestSchema>
export type ImportFoodRequestInput = z.input<typeof importFoodRequestSchema>

export const importFoodResponseSchema = z.object({
  createdItems: z.number().int(),
})
export type ImportFoodResponse = z.infer<typeof importFoodResponseSchema>

// PATCH semantics: absent = unchanged, null = clear (nullable fields only).
// servingWeightGrams and caloriesPerServing are NOT NULL columns, so they
// are optional-but-not-nullable here.
export const updateFoodItemRequestSchema = z
  .object({
    name: foodNameSchema.optional(),
    brand: brandSchema.nullable().optional(),
    servingDescription: servingDescriptionSchema.nullable().optional(),
    servingWeightGrams: servingWeightSchema.optional(),
    caloriesPerServing: caloriesSchema.optional(),
    servingsPerPackage: servingsPerPackageSchema.nullable().optional(),
    fatGrams: macroGramsSchema.nullable().optional(),
    saturatedFatGrams: macroGramsSchema.nullable().optional(),
    carbsGrams: macroGramsSchema.nullable().optional(),
    fiberGrams: macroGramsSchema.nullable().optional(),
    sugarGrams: macroGramsSchema.nullable().optional(),
    proteinGrams: macroGramsSchema.nullable().optional(),
    sodiumMg: milligramsSchema.nullable().optional(),
    potassiumMg: milligramsSchema.nullable().optional(),
    notes: notesSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((field) => field !== undefined), {
    message: 'empty patch',
  })
export type UpdateFoodItemRequest = z.infer<typeof updateFoodItemRequestSchema>
