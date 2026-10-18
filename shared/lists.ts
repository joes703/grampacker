import { z } from 'zod'
import { FOOD_ITEM_CAP } from './food'
import {
  costSchema,
  gearItemResponseSchema,
  importCategoryRefSchema,
  weightGramsSchema,
} from './gear'

// DTO contracts for /api/lists, /api/lists/:id/items and the public
// /api/shares/v2/:slug read. Same rules as shared/gear.ts: response schemas
// are the allowlist (user_id never leaves the server), the DB re-enforces
// every bound below, and PATCH semantics are absent = unchanged, null =
// clear.

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

const listNameSchema = z.string().trim().min(1).max(256)
// Empty string is not a valid description - clients send null to clear.
const descriptionSchema = z.string().trim().min(1).max(2000)
const idSchema = z.string().min(1).max(64)
const sortOrderSchema = z.number().int().min(-1_000_000_000).max(1_000_000_000)
// NOT sortOrderSchema. That one permits negatives, so a client could submit a
// negative packSortOrder; the permutation check happens to reject it today,
// but once 0019's enforcement trigger exists any path past that check would
// RAISE(ABORT) and surface as a 500 where a 400 is correct.
const packRankSchema = z.number().int().min(0).max(PACK_RANK_MAX)
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
    // isShared is the on/off switch and nothing else: it alone decides whether
    // /api/shares/v2/:slug answers. The slug is server-minted and is not set
    // here; POST /api/lists/:id/share-link replaces it with a fresh one, which
    // is how a leaked link is broken without touching isShared.
    isShared: z.boolean().optional(),
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
  // DTO deliberately does not carry it (see publicListItemSchema), because how
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
// the full gear dialog is the place to set them.
export const quickAddListItemRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    description: descriptionSchema.nullable().default(null),
    weightGrams: weightGramsSchema.default(0),
    categoryId: idSchema.nullable().default(null),
    // Per-list membership fields the Quick-Add form exposes. Defaults
    // mirror the DB column defaults so older/simpler clients can omit
    // them. Both-true is statically impossible (refine below); there is
    // no merged-row case here because the row is created fresh, so the
    // refine is the full check (the DB CHECK stays as the backstop).
    quantity: quantitySchema.default(1),
    isWorn: z.boolean().default(false),
    isConsumable: z.boolean().default(false),
  })
  .strict()
  .refine((v) => !(v.isWorn === true && v.isConsumable === true), {
    message: 'an item cannot be both worn and consumable',
  })
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
    packingLocationId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((field) => field !== undefined), {
    message: 'empty patch',
  })
  .refine((v) => !(v.isWorn === true && v.isConsumable === true), {
    message: 'an item cannot be both worn and consumable',
  })
export type UpdateListItemRequest = z.infer<typeof updateListItemRequestSchema>

// ------------------------------------------------------- packing locations

const packingLocationNameSchema = z.string().trim().min(1).max(60)

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

// ---------------------------------------------------------- public share read

// GET /api/shares/v2/:slug response - the ONE anonymous read surface. These
// schemas ARE the public allowlist (the port of the old app's curated
// public_gear_* views; see SECURITY.md "Public read paths" there): strictly
// narrower than the authed DTOs above, and every widening is a security
// decision, not a convenience. Deliberately absent, and asserted absent in
// server/routes/shares.test.ts:
//   - list:  id, slug, userId, isShared, sortOrder, timestamps (the client
//            already knows the slug; the list id is an internal join handle
//            the single-endpoint shape no longer needs to expose)
//   - items: userId, listId, isPacked / isReady (the owner's private
//            packing workflow), timestamps
//   - gear:  id, status, cost, purchaseDate, sortOrder, timestamps
//            (private inventory metadata; gearItemId on the item row is
//            the row identity)
//   - categories: userId, timestamps
// isDraft is deliberately public: the share view shows the work-in-progress
// banner. groupWorn was published on the same footing and honored by
// SharePage until #110 made worn grouping unconditional (2026-07-21). From
// then on nothing read it, on either surface - it was retired from the DTO
// rather than revived, because there is no preference left to express.
export const publicListSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  isDraft: z.boolean(),
})
export type PublicList = z.infer<typeof publicListSchema>

export const publicCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
})
export type PublicCategory = z.infer<typeof publicCategorySchema>

export const publicListItemSchema = z.object({
  id: z.string(),
  gearItemId: z.string(),
  quantity: z.number().int(),
  isWorn: z.boolean(),
  isConsumable: z.boolean(),
  sortOrder: z.number().int(),
  gear: z.object({
    name: z.string(),
    description: z.string().nullable(),
    // Fractional: an individual gear weight carries tenths.
    weightGrams: z.number(),
    categoryId: z.string().nullable(),
  }),
})
export type PublicListItem = z.infer<typeof publicListItemSchema>

// What a share publishes about food: the same four facts it publishes about
// a gear row - what it is, how many, how heavy, and where it sits in the
// order.
//
// Nothing about the PLAN. Day count, meal slots, "not needed" marks and
// packing state stay private, and that line is the whole contract here:
// "2 x 85 g ramen" is a thing in a pack, "Tuesday dinner: leftover curry" is
// a fact about someone's week.
//
// This started as a single aggregate on 2026-08-10 and became rows on
// 2026-08-11. Food you carry is part of the pack you are showing someone,
// which is how comparable lists work; hiding it was never a privacy decision,
// it was a leftover from food being a late arrival. Publishing rows also let
// the aggregate query that existed only for this surface go away - the share
// now sums the rows exactly as the owner's own view does, so there is ONE
// definition of food weight instead of two that could drift apart.
export const publicFoodItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  // What you CARRY, resolved server-side (0024). NOT the raw quantity: that
  // is per-meal for most items and means nothing without the schedule, which
  // a share must never receive.
  unitCount: z.number().int(),
  // Fractional for the same reason gear weight is: one item carries tenths.
  weightGrams: z.number(),
  sortOrder: z.number().int(),
})
export type PublicFoodItem = z.infer<typeof publicFoodItemSchema>

export const publicFoodSchema = z.object({
  items: z.array(publicFoodItemSchema),
})
export type PublicFood = z.infer<typeof publicFoodSchema>

export const sharedListResponseSchema = z.object({
  list: publicListSchema,
  categories: z.array(publicCategorySchema),
  items: z.array(publicListItemSchema),
  food: publicFoodSchema,
})
export type SharedListResponse = z.infer<typeof sharedListResponseSchema>

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
// The server additionally requires the ranks to be a permutation of what the
// touched rows already hold, and requires them all to be in one cohort. Those
// are relational facts this schema cannot see, so they live in the repo.
const packRankEntriesSchema = (cap: number) =>
  z
    .array(z.object({ id: idSchema, packSortOrder: packRankSchema }).strict())
    .max(cap)
    .refine((entries) => uniqueIds(entries.map((e) => e.id)), {
      message: 'duplicate ids',
    })

// Since 0022 a bag's contents are the UNION of gear rows and food rows, and a
// reorder permutes ranks across that union - so the payload carries both
// halves and the server writes them in one batch. The legacy bare-array shape
// (gear only) is still accepted: a browser holding the previous SPA bundle
// keeps working across the deploy, and a gear-only reorder is a legitimate
// union reorder with an empty food half. parseReorderPackRequest normalizes
// both shapes to the object form.
export const reorderPackListItemsRequestSchema = z.union([
  packRankEntriesSchema(LIST_ITEM_CAP).refine((e) => e.length >= 1, {
    message: 'at least one entry is required',
  }),
  z
    .object({
      items: packRankEntriesSchema(LIST_ITEM_CAP).optional(),
      foodItems: packRankEntriesSchema(FOOD_ITEM_CAP).optional(),
    })
    .strict()
    .refine(
      (body) => (body.items?.length ?? 0) + (body.foodItems?.length ?? 0) >= 1,
      { message: 'at least one entry is required' },
    ),
])
export type ReorderPackListItemsRequest = z.infer<
  typeof reorderPackListItemsRequestSchema
>

export type ReorderPackPayload = {
  items: { id: string; packSortOrder: number }[]
  foodItems: { id: string; packSortOrder: number }[]
}

export function normalizeReorderPackRequest(
  parsed: ReorderPackListItemsRequest,
): ReorderPackPayload {
  if (Array.isArray(parsed)) return { items: parsed, foodItems: [] }
  return { items: parsed.items ?? [], foodItems: parsed.foodItems ?? [] }
}

export const reorderPackingLocationsRequestSchema = reorderSchema(
  PACKING_LOCATION_CAP,
)
export type ReorderPackingLocationsRequest = z.infer<
  typeof reorderPackingLocationsRequestSchema
>

// ---------------------------------------------------------------- csv import

// Atomic list import: new categories + new gear + the list + its items
// land in ONE transaction (parity with the old app's
// create_list_with_imported_items RPC). The client plans the import (CSV
// parse + dedup against its library snapshot); tempIds link the layers:
// gear entries reference not-yet-created categories, items reference
// not-yet-created gear. Item sortOrder is the ORIGINAL CSV row index, so
// dropped empty-name rows leave intentional gaps.
const tempIdSchema = z.string().min(1).max(64)

const importListCategorySchema = z
  .object({ tempId: tempIdSchema, name: z.string().trim().min(1).max(128) })
  .strict()

export const importListGearRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), id: idSchema }).strict(),
  z.object({ kind: z.literal('new'), tempId: tempIdSchema }).strict(),
])
export type ImportListGearRef = z.infer<typeof importListGearRefSchema>

// New gear created by the import. Carries cost (the list CSV does carry it -
// our own export emits it, and a Lighterpack list export has `price`), but
// no purchaseDate (no column in the list format) and no status (server
// default), matching the gear-import contract.
//
// costSchema is imported from ./gear rather than redefined: a second copy
// would drift from the 2-decimal-place / max-99,999,999.99 contract the
// server enforces, and the two would disagree silently.
const importListGearEntrySchema = z
  .object({
    tempId: tempIdSchema,
    name: z.string().trim().min(1).max(256),
    description: z.string().trim().min(1).max(2000).nullable().default(null),
    weightGrams: weightGramsSchema.default(0),
    category: importCategoryRefSchema.nullable().default(null),
    cost: costSchema.nullable().default(null),
  })
  .strict()

const importListItemSchema = z
  .object({
    gear: importListGearRefSchema,
    quantity: quantitySchema.default(1),
    isWorn: z.boolean().default(false),
    isConsumable: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(1_000_000_000),
  })
  .strict()
  .refine((v) => !(v.isWorn === true && v.isConsumable === true), {
    message: 'an item cannot be both worn and consumable',
  })

export const importListRequestSchema = z
  .object({
    name: listNameSchema,
    categories: z.array(importListCategorySchema).max(LIST_ITEM_CAP),
    gear: z.array(importListGearEntrySchema).max(LIST_ITEM_CAP),
    items: z.array(importListItemSchema).min(1).max(LIST_ITEM_CAP),
  })
  .strict()
  .superRefine((req, ctx) => {
    const catTempIds = req.categories.map((c) => c.tempId)
    if (!uniqueIds(catTempIds)) {
      ctx.addIssue({ code: 'custom', message: 'duplicate category tempIds' })
      return
    }
    const gearTempIds = req.gear.map((g) => g.tempId)
    if (!uniqueIds(gearTempIds)) {
      ctx.addIssue({ code: 'custom', message: 'duplicate gear tempIds' })
      return
    }
    if (!uniqueIds(req.items.map((i) => i.sortOrder.toString()))) {
      ctx.addIssue({ code: 'custom', message: 'duplicate item sortOrders' })
      return
    }
    // Every symbolic ref must resolve, and every declared temp entity
    // must be used - rejecting orphans keeps the endpoint from being a
    // row-spam vector (same rule as the gear import).
    const declaredCats = new Set(catTempIds)
    const referencedCats = new Set<string>()
    for (const g of req.gear) {
      if (g.category?.kind !== 'new') continue
      if (!declaredCats.has(g.category.tempId)) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown category tempId: ${g.category.tempId}`,
        })
        return
      }
      referencedCats.add(g.category.tempId)
    }
    if (referencedCats.size !== declaredCats.size) {
      ctx.addIssue({ code: 'custom', message: 'unreferenced category tempId' })
      return
    }
    const declaredGear = new Set(gearTempIds)
    const referencedGear = new Set<string>()
    for (const item of req.items) {
      if (item.gear.kind !== 'new') continue
      if (!declaredGear.has(item.gear.tempId)) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown gear tempId: ${item.gear.tempId}`,
        })
        return
      }
      referencedGear.add(item.gear.tempId)
    }
    if (referencedGear.size !== declaredGear.size) {
      ctx.addIssue({ code: 'custom', message: 'unreferenced gear tempId' })
    }
  })
export type ImportListRequest = z.infer<typeof importListRequestSchema>
export type ImportListRequestInput = z.input<typeof importListRequestSchema>
