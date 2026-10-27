import { z } from 'zod'
import {
  categoryNameSchema,
  costSchema,
  gearNameSchema,
  importCategoryRefSchema,
  refineTempIdRelations,
  weightGramsSchema,
} from './gear'
import {
  LIST_ITEM_CAP,
  listNameSchema,
  quantitySchema,
  wornConsumableExclusive,
} from './lists'
import {
  descriptionSchema,
  idSchema,
  tempIdSchema,
  uniqueIds,
} from './schema-primitives'

// POST /api/lists/import - atomic list import: new categories + new gear +
// the list + its items land in ONE transaction. The client plans the import (CSV
// parse + dedup against its library snapshot); tempIds link the layers:
// gear entries reference not-yet-created categories, items reference
// not-yet-created gear. Item sortOrder is the ORIGINAL CSV row index, so
// dropped empty-name rows leave intentional gaps.

const importListCategorySchema = z
  .object({ tempId: tempIdSchema, name: categoryNameSchema })
  .strict()

const importListGearRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), id: idSchema }).strict(),
  z.object({ kind: z.literal('new'), tempId: tempIdSchema }).strict(),
])

// New gear created by the import. Carries cost (the list CSV does carry it -
// our own export emits it, and a Lighterpack list export has `price`), but
// no purchaseDate (no column in the list format) and no status (server
// default), matching the gear-import contract.
//
// Name, description, weight and cost schemas are imported from ./gear rather
// than redefined: these rows land in the gear library, and a second copy of
// its bounds would drift silently.
const importListGearEntrySchema = z
  .object({
    tempId: tempIdSchema,
    name: gearNameSchema,
    description: descriptionSchema.nullable().default(null),
    weightGrams: weightGramsSchema.default(0),
    category: importCategoryRefSchema.nullable().default(null),
    cost: costSchema.nullable().default(null),
  })
  .strict()

const importListItemSchema = wornConsumableExclusive(
  z
    .object({
      gear: importListGearRefSchema,
      quantity: quantitySchema.default(1),
      isWorn: z.boolean().default(false),
      isConsumable: z.boolean().default(false),
      sortOrder: z.number().int().min(0).max(1_000_000_000),
    })
    .strict(),
)

export const importListRequestSchema = z
  .object({
    name: listNameSchema,
    categories: z.array(importListCategorySchema).max(LIST_ITEM_CAP),
    gear: z.array(importListGearEntrySchema).max(LIST_ITEM_CAP),
    items: z.array(importListItemSchema).min(1).max(LIST_ITEM_CAP),
  })
  .strict()
  .superRefine((req, ctx) => {
    // Both tempId layers run through the same relational check as the gear
    // import (shared/gear.ts refineTempIdRelations): unique declarations,
    // resolvable references, no orphans.
    if (
      !refineTempIdRelations(
        'category',
        req.categories,
        req.gear.map((g) => g.category),
        ctx,
      )
    ) {
      return
    }
    if (
      !refineTempIdRelations(
        'gear',
        req.gear,
        req.items.map((i) => i.gear),
        ctx,
      )
    ) {
      return
    }
    if (!uniqueIds(req.items.map((i) => i.sortOrder.toString()))) {
      ctx.addIssue({ code: 'custom', message: 'duplicate item sortOrders' })
    }
  })
export type ImportListRequest = z.infer<typeof importListRequestSchema>
export type ImportListRequestInput = z.input<typeof importListRequestSchema>
