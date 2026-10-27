import { z } from 'zod'
import { FOOD_ITEM_CAP } from './food'
import {
  gearItemResponseSchema,
  gearNameSchema,
  MAX_NAME_LENGTH,
  weightGramsSchema,
} from './gear'
import {
  descriptionSchema,
  idSchema,
  nonEmptyPatch,
  sortOrderSchema,
  uniqueIds,
} from './schema-primitives'

// DTO contracts for /api/lists, /api/lists/:id/items and packing locations.
// Same rules as shared/gear.ts: response schemas are the allowlist (user_id
// never leaves the server), the DB re-enforces every bound below, and PATCH
// semantics are absent = unchanged, null = clear. The public share DTOs live
// in shared/shares.ts; the CSV list import in shared/list-import.ts.

// Caps mirror the 0004 triggers and CHECKs; the DB is authoritative.
export const LIST_CAP = 100
export const LIST_ITEM_CAP = 300
export const PACKING_LOCATION_CAP = 30
export const MAX_LIST_ITEM_QUANTITY = 9999

// Committed pack ranks are unsigned, unlike signed document sortOrder.
// Reorders stage rows at -1, -2, ... inside one transaction to avoid unique
// index collisions, then check every write before committing nonnegative ranks.
// INSERT rejects negative ranks; UPDATE permits the bounded scratch range.
export const PACK_RANK_MAX = 1_000_000_000

// A list name is its own contract, built from the same named bound the UI's
// name inputs use (src/lib/caps.ts re-exports MAX_NAME_LENGTH for them).
// Exported for the list import, which creates the list row.
export const listNameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH)
// NOT sortOrderSchema (shared/schema-primitives.ts). That one permits
// negatives, so a client could submit a negative packSortOrder; the
// permutation check happens to reject it today, but once 0019's enforcement
// trigger exists any path past that check would RAISE(ABORT) and surface as
// a 500 where a 400 is correct.
const packRankSchema = z.number().int().min(0).max(PACK_RANK_MAX)
// Exported for the list import, whose items carry the same quantity bound.
export const quantitySchema = z.number().int().min(1).max(MAX_LIST_ITEM_QUANTITY)

// An item is worn OR consumable, never both. The repo re-checks the MERGED
// row for patches (a patch setting one true while the other is already true
// is a 400); this schema-level refine only rejects the statically impossible
// both-true payload early. Shared by quick-add, the item patch and the list
// import (shared/list-import.ts).
export function wornConsumableExclusive<
  S extends z.ZodType<{ isWorn?: boolean; isConsumable?: boolean }>,
>(schema: S): S {
  return schema.refine((v) => !(v.isWorn === true && v.isConsumable === true), {
    message: 'an item cannot be both worn and consumable',
  })
}

// --------------------------------------------------------------------- lists

export const listResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  slug: z.string(), // server-minted, 6-char base62; share URLs later
  isShared: z.boolean(),
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

export const updateListRequestSchema = nonEmptyPatch(
  z
    .object({
      name: listNameSchema.optional(),
      description: descriptionSchema.nullable().optional(),
      // isShared is the on/off switch and nothing else: it alone decides whether
      // /api/shares/v2/:slug answers. The slug is server-minted and is not set
      // here; POST /api/lists/:id/share-link replaces it with a fresh one, which
      // is how a leaked link is broken without touching isShared.
      isShared: z.boolean().optional(),
      isDraft: z.boolean().optional(),
    })
    .strict(),
)
export type UpdateListRequest = z.infer<typeof updateListRequestSchema>

export const createListFromSelectionRequestSchema = z
  .object({
    name: listNameSchema,
    // Optional notes captured in the create dialog; null (or omitted)
    // leaves the list's description empty, same as plain create.
    description: descriptionSchema.nullable().default(null),
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

// Embedded gear_item response shape: the old
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
  packingLocationId: z.string().nullable(),
  sortOrder: z.number().int(),
  // Rank within this row's packing cohort - the rows sharing
  // (listId, packingLocationId). Authenticated surface only: the public share
  // DTO deliberately does not carry it (see shared/shares.ts), because how
  // someone arranged their bags is not part of what a share link publishes.
  packSortOrder: z.number().int(),
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
// the full gear dialog is the place to set them. The name is gearNameSchema
// because the row lands in the gear library.
export const quickAddListItemRequestSchema = wornConsumableExclusive(
  z
    .object({
      name: gearNameSchema,
      description: descriptionSchema.nullable().default(null),
      weightGrams: weightGramsSchema.default(0),
      categoryId: idSchema.nullable().default(null),
      // Per-list membership fields the Quick-Add form exposes. Defaults
      // mirror the DB column defaults so older/simpler clients can omit
      // them. There is no merged-row case here because the row is created
      // fresh, so the refine is the full check (the DB CHECK stays as the
      // backstop).
      quantity: quantitySchema.default(1),
      isWorn: z.boolean().default(false),
      isConsumable: z.boolean().default(false),
    })
    .strict(),
)
export type QuickAddListItemRequest = z.infer<
  typeof quickAddListItemRequestSchema
>
export type QuickAddListItemRequestInput = z.input<
  typeof quickAddListItemRequestSchema
>

export const updateListItemRequestSchema = wornConsumableExclusive(
  nonEmptyPatch(
    z
      .object({
        quantity: quantitySchema.optional(),
        isWorn: z.boolean().optional(),
        isConsumable: z.boolean().optional(),
        isPacked: z.boolean().optional(),
        isReady: z.boolean().optional(),
        packingLocationId: z.string().uuid().nullable().optional(),
      })
      .strict(),
  ),
)
export type UpdateListItemRequest = z.infer<typeof updateListItemRequestSchema>

// ------------------------------------------------------- packing locations

export const MAX_PACKING_LOCATION_NAME = 60
const packingLocationNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PACKING_LOCATION_NAME)

export const packingLocationResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  containerListItemId: z.string().nullable(),
})
export type PackingLocationResponse = z.infer<
  typeof packingLocationResponseSchema
>

export const createPackingLocationRequestSchema = z.union([
  z.object({ name: packingLocationNameSchema }).strict(),
  z.object({ containerListItemId: idSchema }).strict(),
])
export type CreatePackingLocationRequest = z.infer<
  typeof createPackingLocationRequestSchema
>

export const updatePackingLocationRequestSchema = z
  .object({ name: packingLocationNameSchema })
  .strict()
export type UpdatePackingLocationRequest = z.infer<
  typeof updatePackingLocationRequestSchema
>

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

// Pack reorder gets its OWN payload shape, keyed `packSortOrder`, rather than
// reusing the `sortOrder` array above. One wire shape persisting to two
// different columns depending on which URL it was posted to is a trap: it
// reads as interchangeable, it is not, and it makes the optimistic cache
// mapping guess which field it is patching.
//
// The server additionally requires every row to be in one cohort and the
// ranks to be index-safe (no rank twice within a table, none landing on an
// untouched row of the same table); a free rank is legal. Those are
// relational facts this schema cannot see, so they live in the repo
// (server/repos/pack-reorder.ts).
const packRankEntriesSchema = (cap: number) =>
  z
    .array(z.object({ id: idSchema, packSortOrder: packRankSchema }).strict())
    .max(cap)
    .refine((entries) => uniqueIds(entries.map((e) => e.id)), {
      message: 'duplicate ids',
    })

// A bag's contents are the UNION of gear rows and food rows, and a reorder
// ranks across that union - so the payload carries both halves and the server
// writes them in one transaction. Either half may be empty or absent.
export const reorderPackListItemsRequestSchema = z
  .object({
    items: packRankEntriesSchema(LIST_ITEM_CAP).optional(),
    foodItems: packRankEntriesSchema(FOOD_ITEM_CAP).optional(),
  })
  .strict()
  .refine(
    (body) => (body.items?.length ?? 0) + (body.foodItems?.length ?? 0) >= 1,
    { message: 'at least one entry is required' },
  )
export type ReorderPackListItemsRequest = z.infer<
  typeof reorderPackListItemsRequestSchema
>

export type ReorderPackPayload = {
  items: { id: string; packSortOrder: number }[]
  foodItems: { id: string; packSortOrder: number }[]
}


export const reorderPackingLocationsRequestSchema = reorderSchema(
  PACKING_LOCATION_CAP,
)
export type ReorderPackingLocationsRequest = z.infer<
  typeof reorderPackingLocationsRequestSchema
>
