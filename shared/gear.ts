import { z } from 'zod'
import { decimalNumber } from './decimal'
import {
  descriptionSchema,
  idSchema,
  nonEmptyPatch,
  sortOrderSchema,
  tempIdSchema,
  uniqueIds,
} from './schema-primitives'

// DTO contracts for /api/categories and /api/gear-items. Response schemas
// are the allowlist: fields not named here never leave the server (user_id
// in particular - the client is always self). Canonical-vs-display: the DB
// stores epoch-ms integers, cents, and ISO dates; DTOs speak ISO strings
// and dollars.

// Bounds account growth and response work; SQLite does not require this cap.
// Mirrors the categories_user_cap trigger; the DB is authoritative.
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
const gearStatusSchema = z.enum(GEAR_STATUSES)
export type GearStatus = z.infer<typeof gearStatusSchema>

// Caps mirror the old schema's CHECK constraints; the DB re-enforces them.
// Named constants, not literals, so src/lib/caps.ts can re-export them for
// input maxLength and import clamps instead of hand-copying the numbers.
// (The description bound lives in shared/schema-primitives.ts beside its
// schema; gear and lists share it.)
export const MAX_CATEGORY_NAME = 128
export const MAX_NAME_LENGTH = 256
// Upper bound (grams) for a single item's weight; drafts clamp to this.
export const MAX_ITEM_WEIGHT_GRAMS = 100000

// A weight draft kept between 0 and MAX_ITEM_WEIGHT_GRAMS before it is sent.
export function clampWeightGrams(grams: number): number {
  return Math.max(0, Math.min(grams, MAX_ITEM_WEIGHT_GRAMS))
}

// Exported for the list import, which creates gear-library rows (categories
// and gear) and must hold them to these same bounds.
export const categoryNameSchema = z.string().trim().min(1).max(MAX_CATEGORY_NAME)
export const gearNameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH)
// Tenths of a gram, not whole grams: packing multiples of a small item makes
// the fraction matter. One decimal -
// it is the precision the UI renders, so everything storable is displayable,
// and a rejected value is a real signal rather than silent rounding. Widening
// to more decimals later is backwards-compatible; narrowing is not.
export const weightGramsSchema = decimalNumber({ min: 0, max: MAX_ITEM_WEIGHT_GRAMS, decimals: 1 })

// Dollars with at most 2 decimal places (stored as integer cents; REAL is
// the wrong tool for money and numeric(10,2) does not exist in SQLite).
// The round-trip check in decimalNumber, not the epsilon form this used to
// carry: the epsilon let 1e-9 through (stored as 0 cents) and, near the cap,
// 99999999.00999999 (v*100 lands exactly on an integer). Max stays inclusive -
// src/lib/csv/money.ts relies on that.
export const MAX_COST = 99_999_999.99
export const costSchema = decimalNumber({ min: 0, max: MAX_COST, decimals: 2 })

// Real calendar date, ISO YYYY-MM-DD (rejects 2026-02-30). zod's own check
// knows leap years.
export const isoDateSchema = z.iso.date()

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
export const updateGearItemRequestSchema = nonEmptyPatch(
  z
    .object({
      name: gearNameSchema.optional(),
      description: descriptionSchema.nullable().optional(),
      weightGrams: weightGramsSchema.optional(),
      categoryId: idSchema.nullable().optional(),
      cost: costSchema.nullable().optional(),
      purchaseDate: isoDateSchema.nullable().optional(),
      status: gearStatusSchema.optional(),
    })
    .strict(),
)
export type UpdateGearItemRequest = z.infer<typeof updateGearItemRequestSchema>

// ------------------------------------------------------------------ bulk ops

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

export const importCategoryRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), id: idSchema }).strict(),
  z.object({ kind: z.literal('new'), tempId: tempIdSchema }).strict(),
])

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

// The relational half of import well-formedness, shared by both gear-import
// variants below and by the list import's category and gear layers: declared
// tempIds must be unique, every `kind: 'new'` reference must resolve against
// them, and every declared entry must be referenced - rejecting orphans keeps
// an import endpoint from being a row-spam vector. An oversized body with
// these defects is MALFORMED (uniform 400), never merely over-cap (422).
// `noun` appears in the issue messages. Returns false when an issue was
// added, so a caller checking several layers stops at the first defect.
export function refineTempIdRelations(
  noun: 'category' | 'gear',
  declared: readonly { tempId: string }[],
  refs: readonly ({ kind: string; tempId?: string } | null | undefined)[],
  ctx: z.RefinementCtx,
): boolean {
  const tempIds = declared.map((d) => d.tempId)
  if (!uniqueIds(tempIds)) {
    ctx.addIssue({ code: 'custom', message: `duplicate ${noun} tempIds` })
    return false
  }
  const declaredSet = new Set(tempIds)
  const referenced = new Set<string>()
  for (const ref of refs) {
    if (ref?.kind !== 'new') continue
    const tempId = ref.tempId as string
    if (!declaredSet.has(tempId)) {
      ctx.addIssue({ code: 'custom', message: `unknown ${noun} tempId: ${tempId}` })
      return false
    }
    referenced.add(tempId)
  }
  if (referenced.size !== declaredSet.size) {
    ctx.addIssue({ code: 'custom', message: `unreferenced ${noun} tempId` })
    return false
  }
  return true
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
    .superRefine((req, ctx) => {
      refineTempIdRelations(
        'category',
        req.categories,
        req.items.map((i) => i.category),
        ctx,
      )
    })
}

// The public contract: maxima are the REAL caps (the triggers abort at 500,
// so anything larger was a guaranteed late failure after 500 inserts had
// run - the old 2000 ceiling promised what the DB always refused).
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
