import { z } from 'zod'

// DTO contracts for /api/categories and /api/gear-items. Response schemas
// are the allowlist: fields not named here never leave the server (user_id
// in particular - the client is always self). Canonical-vs-display: the DB
// stores epoch-ms integers, cents, and ISO dates; DTOs speak ISO strings
// and dollars.

export const GEAR_STATUSES = [
  'active',
  'needs_repair',
  'loaned_out',
  'need_to_buy',
] as const
export const gearStatusSchema = z.enum(GEAR_STATUSES)
export type GearStatus = z.infer<typeof gearStatusSchema>

// Caps mirror the old schema's CHECK constraints; the DB re-enforces them.
const categoryNameSchema = z.string().trim().min(1).max(128)
const gearNameSchema = z.string().trim().min(1).max(256)
// Empty string is not a valid description - clients send null to clear.
const descriptionSchema = z.string().trim().min(1).max(2000)
const weightGramsSchema = z.number().int().min(0).max(100000)
const idSchema = z.string().min(1).max(64)

// Dollars with at most 2 decimal places (stored as integer cents; REAL is
// the wrong tool for money and numeric(10,2) does not exist in SQLite).
const costSchema = z
  .number()
  .min(0)
  .max(99_999_999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
    message: 'cost must have at most 2 decimal places',
  })

// Real calendar date, ISO YYYY-MM-DD (rejects 2026-02-30).
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => {
      const d = new Date(`${v}T00:00:00Z`)
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
    },
    { message: 'not a real calendar date' },
  )

const sortOrderSchema = z.number().int().min(-1_000_000_000).max(1_000_000_000)

// ---------------------------------------------------------------- categories

export const categoryResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  createdAt: z.string(), // ISO timestamp
})
export type CategoryResponse = z.infer<typeof categoryResponseSchema>

export const createCategoryRequestSchema = z
  .object({ name: categoryNameSchema })
  .strict()
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>

export const updateCategoryRequestSchema = createCategoryRequestSchema
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>

// ---------------------------------------------------------------- gear items

export const gearItemResponseSchema = z.object({
  id: z.string(),
  categoryId: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  weightGrams: z.number().int(),
  cost: z.number().nullable(), // dollars
  purchaseDate: z.string().nullable(), // ISO YYYY-MM-DD
  status: gearStatusSchema,
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type GearItemResponse = z.infer<typeof gearItemResponseSchema>

export const createGearItemRequestSchema = z
  .object({
    name: gearNameSchema,
    description: descriptionSchema.nullable().default(null),
    weightGrams: weightGramsSchema.default(0),
    categoryId: idSchema.nullable().default(null),
    cost: costSchema.nullable().default(null),
    purchaseDate: isoDateSchema.nullable().default(null),
    status: gearStatusSchema.default('active'),
  })
  .strict()
export type CreateGearItemRequest = z.infer<typeof createGearItemRequestSchema>
// What a CLIENT passes: the schema's defaults make everything but name
// optional on the way in (z.infer above is the post-parse shape the server
// sees, with every default filled).
export type CreateGearItemRequestInput = z.input<
  typeof createGearItemRequestSchema
>

// PATCH semantics: absent = unchanged, null = clear (nullable fields only).
export const updateGearItemRequestSchema = z
  .object({
    name: gearNameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    weightGrams: weightGramsSchema.optional(),
    categoryId: idSchema.nullable().optional(),
    cost: costSchema.nullable().optional(),
    purchaseDate: isoDateSchema.nullable().optional(),
    status: gearStatusSchema.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((field) => field !== undefined), {
    message: 'empty patch',
  })
export type UpdateGearItemRequest = z.infer<typeof updateGearItemRequestSchema>

// ------------------------------------------------------------------ bulk ops

function uniqueIds(ids: string[]): boolean {
  return new Set(ids).size === ids.length
}

// All-or-nothing: one non-owned id rejects the whole call, zero writes.
export const reorderRequestSchema = z
  .array(z.object({ id: idSchema, sortOrder: sortOrderSchema }).strict())
  .min(1)
  .max(500)
  .refine((entries) => uniqueIds(entries.map((e) => e.id)), {
    message: 'duplicate ids',
  })
export type ReorderRequest = z.infer<typeof reorderRequestSchema>

export const bulkDeleteRequestSchema = z
  .object({
    ids: z.array(idSchema).min(1).max(500).refine(uniqueIds, {
      message: 'duplicate ids',
    }),
  })
  .strict()
export type BulkDeleteRequest = z.infer<typeof bulkDeleteRequestSchema>

export const bulkMoveRequestSchema = z
  .object({
    ids: z.array(idSchema).min(1).max(500).refine(uniqueIds, {
      message: 'duplicate ids',
    }),
    categoryId: idSchema.nullable(), // null = bulk uncategorize
  })
  .strict()
export type BulkMoveRequest = z.infer<typeof bulkMoveRequestSchema>
