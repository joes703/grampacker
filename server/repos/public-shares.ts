import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import {
  categories,
  gearItems,
  listFoodItemSlots,
  listFoodItems,
  listItems,
  lists,
} from '../db/schema'
import { foodUnitCount } from '../../shared/food'

// Anonymous read access for the public share surface (/api/shares/v2/:slug).
// Deliberately NOT part of reposForUser: there is no user. This is the
// port of the old app's curated public_gear_* views - every select below
// names its public columns explicitly (never the full table), and every
// statement self-gates on slug + is_shared, so nothing can be read
// through this module that the owner didn't opt in to publishing.
//
// The row shapes are defined here (not imported from shared/) to keep the
// repo layer DTO-free like its siblings; the route maps these to
// SharedListResponse field-by-field, which keeps the response allowlist
// enforcement visible at the handler.

export type PublicListRow = {
  name: string
  description: string | null
  isDraft: boolean
}

export type PublicCategoryRow = {
  id: string
  name: string
  sortOrder: number
}

export type PublicListItemRow = {
  id: string
  gearItemId: string
  quantity: number
  isWorn: boolean
  isConsumable: boolean
  sortOrder: number
  gearName: string
  gearDescription: string | null
  gearWeightGrams: number
  gearCategoryId: string | null
}

export type PublicFoodItemRow = {
  id: string
  name: string
  // What you CARRY, already resolved. The share publishes this instead of the
  // raw quantity because quantity alone is meaningless without knowing
  // whether it is per-meal, and the per-meal case needs the schedule that a
  // share must not receive.
  unitCount: number
  weightGrams: number
  sortOrder: number
}

export type PublicShare = {
  list: PublicListRow
  categories: PublicCategoryRow[]
  items: PublicListItemRow[]
  /** The food a share publishes: what it is, how many you carry, how heavy,
   *  and its order. Named columns only, like every other select here.
   *
   *  What stays private is the PLAN - day count, meal slots, "not needed"
   *  marks, packing state. The one thing this module reads from that half is
   *  the COUNT of an item's slot links (0024), because a per-meal item's
   *  carried count is quantity x meals and the share must publish the answer
   *  rather than the arithmetic. No day, meal or slot id crosses.
   *  "2 x 85 g ramen" is a thing in a pack; "Tuesday dinner: leftover curry"
   *  is a fact about someone's week. */
  food: PublicFoodItemRow[]
}

export function createPublicSharesRepo(db: Db) {
  return {
    // One db.batch = one transaction, so the list row, its items and the
    // referenced categories are a consistent snapshot (the old app's three
    // separate PostgREST fetches could interleave with an unshare; this
    // cannot). Unknown slug and is_shared = false are indistinguishable by
    // construction - every statement carries the same gate, so both cases
    // return zero rows everywhere.
    async getBySlug(slug: string): Promise<PublicShare | null> {
      const shareGate = and(eq(lists.slug, slug), eq(lists.isShared, true))

      const listQuery = db
        .select({
          name: lists.name,
          description: lists.description,
          isDraft: lists.isDraft,
        })
        .from(lists)
        .where(shareGate)

      const itemsQuery = db
        .select({
          id: listItems.id,
          gearItemId: listItems.gearItemId,
          quantity: listItems.quantity,
          isWorn: listItems.isWorn,
          isConsumable: listItems.isConsumable,
          sortOrder: listItems.sortOrder,
          gearName: gearItems.name,
          gearDescription: gearItems.description,
          gearWeightGrams: gearItems.weightGrams,
          gearCategoryId: gearItems.categoryId,
        })
        .from(listItems)
        .innerJoin(gearItems, eq(gearItems.id, listItems.gearItemId))
        .innerJoin(lists, eq(lists.id, listItems.listId))
        .where(shareGate)
        .orderBy(asc(listItems.sortOrder))

      // Only categories actually referenced by this list's items, resolved
      // through joins with a single bound parameter - never inArray over a
      // collected id list (D1 caps bound params at 100; a 300-item list
      // could reference more). Uncategorized gear (null category_id) drops
      // out via the inner join and renders as the client-side
      // "Uncategorized" group.
      const categoriesQuery = db
        .selectDistinct({
          id: categories.id,
          name: categories.name,
          sortOrder: categories.sortOrder,
        })
        .from(categories)
        .innerJoin(gearItems, eq(gearItems.categoryId, categories.id))
        .innerJoin(listItems, eq(listItems.gearItemId, gearItems.id))
        .innerJoin(lists, eq(lists.id, listItems.listId))
        .where(shareGate)
        .orderBy(asc(categories.sortOrder), asc(categories.name))

      // Never JOIN this to list_food_item_slots. A join returns one 500 g bag
      // of trail mix five times over for a bag scheduled across five lunches -
      // both as duplicate rows and, if anyone re-adds a sum, as 2500 g.
      //
      // The slot COUNT is read separately below (0024) and combined in JS, so
      // this statement still returns exactly one row per food item.
      const foodQuery = db
        .select({
          id: listFoodItems.id,
          name: listFoodItems.name,
          quantity: listFoodItems.quantity,
          isPerMeal: listFoodItems.isPerMeal,
          weightGrams: listFoodItems.weightGrams,
          sortOrder: listFoodItems.sortOrder,
        })
        .from(listFoodItems)
        .innerJoin(lists, eq(lists.id, listFoodItems.listId))
        .where(shareGate)
        .orderBy(asc(listFoodItems.sortOrder))

      // The slot LINKS, and only their item ids - never the slot rows, never
      // which day or meal. A per-meal item's carried count is quantity x the
      // number of meals it is in (0024), so the count is the one fact about
      // the plan a share cannot avoid touching.
      //
      // A separate statement rather than a join onto foodQuery: joining would
      // fan each food row out once per link, which is exactly the duplicate
      // that made a shared bag weigh five times in the first place. Counted in
      // JS below, where a row is a row.
      const foodSlotLinkQuery = db
        .select({ foodItemId: listFoodItemSlots.foodItemId })
        .from(listFoodItemSlots)
        .innerJoin(lists, eq(lists.id, listFoodItemSlots.listId))
        .where(shareGate)

      const [listRows, itemRows, categoryRows, foodRows, foodSlotLinkRows] =
        await db.batch([
          listQuery,
          itemsQuery,
          categoriesQuery,
          foodQuery,
          foodSlotLinkQuery,
        ])

      const list = listRows[0]
      if (!list) return null

      const slotCountByItem = new Map<string, number>()
      for (const link of foodSlotLinkRows) {
        slotCountByItem.set(
          link.foodItemId,
          (slotCountByItem.get(link.foodItemId) ?? 0) + 1,
        )
      }

      return {
        list,
        categories: categoryRows,
        items: itemRows,
        // Resolved to a carried count here, so the DTO below never has to
        // carry isPerMeal or the schedule to explain a number.
        food: foodRows.map((row) => ({
          id: row.id,
          name: row.name,
          unitCount: foodUnitCount({
            quantity: row.quantity,
            isPerMeal: row.isPerMeal,
            slotIds: new Array<string>(slotCountByItem.get(row.id) ?? 0),
          }),
          weightGrams: row.weightGrams,
          sortOrder: row.sortOrder,
        })),
      }
    },
  }
}

export type PublicSharesRepo = ReturnType<typeof createPublicSharesRepo>
