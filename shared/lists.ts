import { z } from 'zod'
import {
  costSchema,
  gearItemResponseSchema,
  importCategoryRefSchema,
  weightGramsSchema,
} from './gear'

// DTO contracts for /api/lists, /api/lists/:id/items and the public
// /api/shares/:slug read. Same rules as shared/gear.ts: response schemas
// are the allowlist (user_id never leaves the server), the DB re-enforces
// every bound below, and PATCH semantics are absent = unchanged, null =
// clear.

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
  // The attached food plan (a live reference), or null. The client resolves
  // the plan's NAME from its own ['food-plans'] cache - the list row carries
  // only the pointer, not a denormalized name that could drift.
  foodPlanId: z.string().nullable(),
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
    // Flipping isShared is the whole share/unshare mechanism: the slug is
    // minted at creation and never changes, so the toggle alone controls
    // whether /api/shares/:slug answers. To break a leaked link, duplicate
    // the list (fresh slug) and unshare the original.
    isShared: z.boolean().optional(),
    groupWorn: z.boolean().optional(),
    readyChecksEnabled: z.boolean().optional(),
    isDraft: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((field) => field !== undefined), {
    message: 'empty patch',
  })
export type UpdateListRequest = z.infer<typeof updateListRequestSchema>

// Attach a food plan to a list (PUT /api/lists/:id/food-plan). Detach is a
// bodyless DELETE, so it needs no schema. The plan id is validated for
// ownership server-side; a non-owned/unknown id is a 400 invalid_plan.
export const attachFoodPlanRequestSchema = z
  .object({ foodPlanId: idSchema })
  .strict()
export type AttachFoodPlanRequest = z.infer<typeof attachFoodPlanRequestSchema>

// The food pack toggle (PUT /api/lists/:id/food-pack/:foodItemId), design 6
// rule 3. expectedFoodPlanId is the plan link the client OBSERVED when it
// rendered the checklist - the compare-and-swap value, and it is REQUIRED and
// non-null: a checklist only exists under an attached plan, so there is no
// legitimate null observation (unlike duplicate's expectedFoodPlanId, where
// "I saw no plan" is a real state). Both directions carry it; an unpack
// gated only on row existence would delete a checkmark made under a newer
// plan.
export const toggleFoodPackRequestSchema = z
  .object({
    packed: z.boolean(),
    expectedFoodPlanId: idSchema,
  })
  .strict()
export type ToggleFoodPackRequest = z.infer<typeof toggleFoodPackRequestSchema>

// applied:false = the compare-and-swap lost (the plan link moved after the
// client observed it). NOT an error: the click simply lost the race, and the
// client rolls its optimistic tick back and refetches. Deliberately narrow -
// never the whole pack set - because packing is the highest-frequency
// mutation in the app (design 6).
export const toggleFoodPackResponseSchema = z.object({
  foodItemId: z.string(),
  packed: z.boolean(),
  applied: z.boolean(),
})
export type ToggleFoodPackResponse = z.infer<typeof toggleFoodPackResponseSchema>

// GET /api/lists/:id/food-pack - the checklist's read. Ids only: row
// presence in food_pack_state means packed, so the set IS the state.
export const foodPackStateResponseSchema = z.object({
  packedFoodItemIds: z.array(z.string()),
})
export type FoodPackStateResponse = z.infer<typeof foodPackStateResponseSchema>

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
  })
  .strict()
  .refine((v) => Object.values(v).some((field) => field !== undefined), {
    message: 'empty patch',
  })
  .refine((v) => !(v.isWorn === true && v.isConsumable === true), {
    message: 'an item cannot be both worn and consumable',
  })
export type UpdateListItemRequest = z.infer<typeof updateListItemRequestSchema>

// ---------------------------------------------------------- public share read

// GET /api/shares/:slug response - the ONE anonymous read surface. These
// schemas ARE the public allowlist (the port of the old app's curated
// public_gear_* views; see SECURITY.md "Public read paths" there): strictly
// narrower than the authed DTOs above, and every widening is a security
// decision, not a convenience. Deliberately absent, and asserted absent in
// server/routes/shares.test.ts:
//   - list:  id, slug, userId, isShared, sortOrder, readyChecksEnabled,
//            timestamps (the client already knows the slug; the list id is
//            an internal join handle the single-endpoint shape no longer
//            needs to expose)
//   - items: userId, listId, isPacked / isReady (the owner's private
//            packing workflow), timestamps
//   - gear:  id, status, cost, purchaseDate, sortOrder, timestamps
//            (private inventory metadata; gearItemId on the item row is
//            the row identity)
//   - categories: userId, timestamps
//   - food:  everything except the projected weight + incomplete flag
//            (design 7: no plan id/name, no meals or days, no entries, no
//            per-food nutrition; the two scalars below are the ONLY food
//            data an anonymous reader can reach anywhere in the system)
// groupWorn and isDraft are deliberately public: the share view honors the
// owner's worn-grouping preference and shows the work-in-progress banner.
export const publicListSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  groupWorn: z.boolean(),
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
    // Fractional: an individual gear weight carries tenths. Distinct from
    // publicFoodSchema.weightGrams below, which stays integer because the food
    // projection is rounded ONCE server-side before it is published.
    weightGrams: z.number(),
    categoryId: z.string().nullable(),
  }),
})
export type PublicListItem = z.infer<typeof publicListItemSchema>

// The attached food plan, collapsed to its projected pack weight (design 7).
// A nullable OBJECT, not two bare scalars: null means "no plan attached",
// which `{ weightGrams: 0, incomplete: false }` - a real attached plan that
// currently weighs nothing - must stay distinguishable from. weightGrams is
// already rounded ONCE server-side (roundProjectedGrams); incomplete travels
// with it so an unprojectable entry can never publish a silently
// undercounted total.
export const publicFoodSchema = z.object({
  weightGrams: z.number().int(),
  incomplete: z.boolean(),
})
export type PublicFood = z.infer<typeof publicFoodSchema>

export const sharedListResponseSchema = z.object({
  list: publicListSchema,
  categories: z.array(publicCategorySchema),
  items: z.array(publicListItemSchema),
  food: publicFoodSchema.nullable(),
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
