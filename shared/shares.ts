import { z } from 'zod'

// GET /api/shares/v2/:slug response - the ONE anonymous read surface. These
// schemas ARE the public allowlist (the port of the old app's curated
// public_gear_* views; see SECURITY.md "Public read paths" there): strictly
// narrower than the authed DTOs in shared/lists.ts and shared/gear.ts, and
// every widening is a security decision, not a convenience. Deliberately
// absent, and asserted absent in server/routes/shares.test.ts:
//   - list:  id, slug, userId, isShared, sortOrder, timestamps (the client
//            already knows the slug; the list id is an internal join handle
//            the single-endpoint shape no longer needs to expose)
//   - items: userId, listId, isPacked / isReady (the owner's private
//            packing workflow), timestamps, packSortOrder (how someone
//            arranged their bags is not part of what a share link publishes)
//   - gear:  id, status, cost, purchaseDate, sortOrder, timestamps
//            (private inventory metadata; gearItemId on the item row is
//            the row identity)
//   - categories: userId, timestamps
// isDraft is deliberately public: the share view shows the work-in-progress
// banner. groupWorn was published on the same footing and honored by
// SharePage until #110 made worn grouping unconditional (2026-07-21). From
// then on nothing read it, on either surface - it was retired from the DTO
// rather than revived, because there is no preference left to express.
const publicListSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  isDraft: z.boolean(),
})
export type PublicList = z.infer<typeof publicListSchema>

const publicCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
})
export type PublicCategory = z.infer<typeof publicCategorySchema>

const publicListItemSchema = z.object({
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
const publicFoodItemSchema = z.object({
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

const publicFoodSchema = z.object({
  items: z.array(publicFoodItemSchema),
})

export const sharedListResponseSchema = z.object({
  list: publicListSchema,
  categories: z.array(publicCategorySchema),
  items: z.array(publicListItemSchema),
  food: publicFoodSchema,
})
export type SharedListResponse = z.infer<typeof sharedListResponseSchema>
