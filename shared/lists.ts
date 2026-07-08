import { z } from 'zod'
import { gearItemResponseSchema } from './gear'

// DTO contracts for /api/lists and /api/lists/:id/items. Same rules as
// shared/gear.ts: response schemas are the allowlist (user_id never
// leaves the server), the DB re-enforces every bound below, and PATCH
// semantics are absent = unchanged, null = clear.
//
// isShared is deliberately NOT in the update schema: the column exists
// (schema day one, so no table rebuild later) but flipping it is the
// public-share slice's job - exposing the toggle before /r/:slug exists
// would let a list be "shared" with no page to see it on.

// Caps mirror the 0004 triggers and CHECKs; the DB is authoritative.
export const LIST_CAP = 100
export const LIST_ITEM_CAP = 300
export const MAX_LIST_ITEM_QUANTITY = 9999

const listNameSchema = z.string().trim().min(1).max(256)
// Empty string is not a valid description - clients send null to clear.
const descriptionSchema = z.string().trim().min(1).max(2000)
const idSchema = z.string().min(1).max(64)
const sortOrderSchema = z.number().int().min(-1_000_000_000).max(1_000_000_000)
const quantitySchema = z.number().int().min(1).max(MAX_LIST_ITEM_QUANTITY)

function uniqueIds(ids: string[]): boolean {
  return new Set(ids).size === ids.length
}

// --------------------------------------------------------------------- lists

export const listResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  slug: z.string(), // server-minted, 6-char base62; share URLs later
  isShared: z.boolean(),
  groupWorn: z.boolean(),
  readyChecksEnabled: z.boolean(),
  isDraft: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(), // ISO timestamp
  updatedAt: z.string(),
})
export type ListResponse = z.infer<typeof listResponseSchema>

export const createListRequestSchema = z
  .object({ name: listNameSchema })
  .strict()
export type CreateListRequest = z.infer<typeof createListRequestSchema>

export const updateListRequestSchema = z
  .object({
    name: listNameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    groupWorn: z.boolean().optional(),
    readyChecksEnabled: z.boolean().optional(),
    isDraft: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((field) => field !== undefined), {
    message: 'empty patch',
  })
export type UpdateListRequest = z.infer<typeof updateListRequestSchema>

export const createListFromSelectionRequestSchema = z
  .object({
    name: listNameSchema,
    gearItemIds: z
      .array(idSchema)
      .min(1)
      .max(LIST_ITEM_CAP)
      .refine(uniqueIds, { message: 'duplicate ids' }),
  })
  .strict()
export type CreateListFromSelectionRequest = z.infer<
  typeof createListFromSelectionRequestSchema
>

// ---------------------------------------------------------------- list items

// Embedded gear_item response shape (REWRITE_PLAN.md section 5): the old
// SPA's ListItemWithGear carried the joined gear row, so cache keys and
// invalidation port unchanged. gearItemId is kept alongside gearItem.id
// for parity with the old row shape.
export const listItemResponseSchema = z.object({
  id: z.string(),
  listId: z.string(),
  gearItemId: z.string(),
  quantity: z.number().int(),
  isWorn: z.boolean(),
  isConsumable: z.boolean(),
  isPacked: z.boolean(),
  isReady: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  gearItem: gearItemResponseSchema,
})
export type ListItemResponse = z.infer<typeof listItemResponseSchema>

export const addListItemRequestSchema = z
  .object({ gearItemId: idSchema })
  .strict()
export type AddListItemRequest = z.infer<typeof addListItemRequestSchema>

// Quick-Add: creates a gear item AND its membership row in one atomic
// call (the old add_gear_item_with_list_item RPC). cost/purchaseDate/
// status are deliberately absent - the old RPC forced them null/default;
// the full gear dialog is the place to set them.
export const quickAddListItemRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    description: descriptionSchema.nullable().default(null),
    weightGrams: z.number().int().min(0).max(100000).default(0),
    categoryId: idSchema.nullable().default(null),
  })
  .strict()
export type QuickAddListItemRequest = z.infer<
  typeof quickAddListItemRequestSchema
>
export type QuickAddListItemRequestInput = z.input<
  typeof quickAddListItemRequestSchema
>

// The worn/consumable exclusivity CHECK is enforced against the MERGED
// row in the repo (a patch setting one true while the other is already
// true is a 400); this refine only rejects the statically-impossible
// both-true patch early.
export const updateListItemRequestSchema = z
  .object({
    quantity: quantitySchema.optional(),
    isWorn: z.boolean().optional(),
    isConsumable: z.boolean().optional(),
    isPacked: z.boolean().optional(),
    isReady: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((field) => field !== undefined), {
    message: 'empty patch',
  })
  .refine((v) => !(v.isWorn === true && v.isConsumable === true), {
    message: 'an item cannot be both worn and consumable',
  })
export type UpdateListItemRequest = z.infer<typeof updateListItemRequestSchema>

// ------------------------------------------------------------------ reorders

// All-or-nothing, same contract as gear. Max mirrors the relevant cap.
function reorderSchema(max: number) {
  return z
    .array(z.object({ id: idSchema, sortOrder: sortOrderSchema }).strict())
    .min(1)
    .max(max)
    .refine((entries) => uniqueIds(entries.map((e) => e.id)), {
      message: 'duplicate ids',
    })
}

export const reorderListsRequestSchema = reorderSchema(LIST_CAP)
export type ReorderListsRequest = z.infer<typeof reorderListsRequestSchema>

export const reorderListItemsRequestSchema = reorderSchema(LIST_ITEM_CAP)
export type ReorderListItemsRequest = z.infer<
  typeof reorderListItemsRequestSchema
>
