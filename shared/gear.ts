import { z } from 'zod'
import { decimalNumber } from './decimal'

// DTO contracts for /api/categories and /api/gear-items. Response schemas
// are the allowlist: fields not named here never leave the server (user_id
// in particular - the client is always self). Canonical-vs-display: the DB
// stores epoch-ms integers, cents, and ISO dates; DTOs speak ISO strings
// and dollars.

// Mirrors the 0021 categories_user_cap trigger; the DB is authoritative.
// Distinct from the gear cap even though the values match - they are
// different contracts that happen to agree today.
export const CATEGORY_CAP = 500

// Mirrors the gear_items_user_cap trigger (0003, recreated in 0013); the DB
// is authoritative. Single source: src/lib/caps.ts re-exports this for the
// client preflights.
export const GEAR_ITEM_CAP = 500

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
// Tenths of a gram, not whole grams: packing multiples of a small item makes
// the fraction matter. One decimal -
// it is the precision the UI renders, so everything storable is displayable,
// and a rejected value is a real signal rather than silent rounding. Widening
// to more decimals later is backwards-compatible; narrowing is not.
export const weightGramsSchema = decimalNumber({ min: 0, max: 100000, decimals: 1 })
const idSchema = z.string().min(1).max(64)

// Dollars with at most 2 decimal places (stored as integer cents; REAL is
// the wrong tool for money and numeric(10,2) does not exist in SQLite).
export const costSchema = z
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
  weightGrams: z.number(),
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
// The 500 here is a TRANSPORT bound shared by /gear-items/order and
// /categories/order, deliberately a literal: writing GEAR_ITEM_CAP or
// CATEGORY_CAP here would couple one contract to the other's cap. It must
// stay >= both caps (500 gear per user, CATEGORY_CAP categories per user)
// or a full reorder becomes inexpressible.
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

// ---------------------------------------------------------------- csv import

// Atomic gear-library import: new categories and new gear land in ONE
// transaction (the old app created categories before the gear insert
// non-atomically, so a mid-flight failure orphaned the categories). The
// client plans the import (CSV parse + dedup against its library snapshot)
// and references not-yet-created categories by a client-minted tempId; the
// server mints the real ids.
const tempIdSchema = z.string().min(1).max(64)

export const importCategoryRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), id: idSchema }).strict(),
  z.object({ kind: z.literal('new'), tempId: tempIdSchema }).strict(),
])
export type ImportCategoryRef = z.infer<typeof importCategoryRefSchema>

const importGearCategoryEntrySchema = z
  .object({ tempId: tempIdSchema, name: categoryNameSchema })
  .strict()
const importGearItemEntrySchema = z
  .object({
    name: gearNameSchema,
    description: descriptionSchema.nullable().default(null),
    weightGrams: weightGramsSchema.default(0),
    cost: costSchema.nullable().default(null),
    purchaseDate: isoDateSchema.nullable().default(null),
    category: importCategoryRefSchema.nullable().default(null),
  })
  .strict()

// The relational half of well-formedness, shared by BOTH schema variants
// below: an oversized body with duplicate tempIds or dangling references is
// MALFORMED (uniform 400), never merely over-cap (422).
function refineImportGearRelations(
  req: {
    categories: { tempId: string }[]
    items: { category: { kind: string; tempId?: string } | null }[]
  },
  ctx: z.RefinementCtx,
): void {
  const tempIds = req.categories.map((c) => c.tempId)
  if (!uniqueIds(tempIds)) {
    ctx.addIssue({ code: 'custom', message: 'duplicate category tempIds' })
    return
  }
  const declared = new Set(tempIds)
  const referenced = new Set<string>()
  for (const item of req.items) {
    if (item.category?.kind !== 'new') continue
    const tempId = item.category.tempId as string
    if (!declared.has(tempId)) {
      ctx.addIssue({
        code: 'custom',
        message: `unknown category tempId: ${tempId}`,
      })
      return
    }
    referenced.add(tempId)
  }
  // Every declared category must be used - rejecting orphans keeps the
  // endpoint from being a category-spam vector.
  if (referenced.size !== declared.size) {
    ctx.addIssue({ code: 'custom', message: 'unreferenced category tempId' })
  }
}

// One construction, two variants differing ONLY in the array maxima - the
// shape and every relational refinement are identical, which is what lets
// the route parse structure first (any failure there is the uniform 400)
// and answer the caps as their own 422 dialect afterwards.
function importGearSchema(caps: { categories: number; items: number } | null) {
  const categories = z.array(importGearCategoryEntrySchema)
  const items = z.array(importGearItemEntrySchema).min(1)
  return z
    .object({
      categories: caps ? categories.max(caps.categories) : categories,
      items: caps ? items.max(caps.items) : items,
    })
    .strict()
    .superRefine(refineImportGearRelations)
}

// The public contract: maxima are the REAL caps (the triggers abort at 500,
// so anything larger was a guaranteed late failure after D1 executed 500+
// statements - the old 2000 ceiling promised what the DB always refused).
export const importGearRequestSchema = importGearSchema({
  categories: CATEGORY_CAP,
  items: GEAR_ITEM_CAP,
})
// The route's stage-1 parse: same schema, uncapped, so a well-formed but
// oversized import reaches the route's own length checks and gets the
// actionable 422 instead of a generic 400.
export const importGearStructureSchema = importGearSchema(null)
export type ImportGearRequest = z.infer<typeof importGearRequestSchema>
export type ImportGearRequestInput = z.input<typeof importGearRequestSchema>

export const importGearResponseSchema = z.object({
  createdCategories: z.number().int(),
  createdItems: z.number().int(),
})
export type ImportGearResponse = z.infer<typeof importGearResponseSchema>
