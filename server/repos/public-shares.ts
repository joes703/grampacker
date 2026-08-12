import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import {
  categories,
  gearItems,
  listFoodItems,
  listItems,
  lists,
} from '../db/schema'

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
  quantity: number
  weightGrams: number
  sortOrder: number
}

export type PublicShare = {
  list: PublicListRow
  categories: PublicCategoryRow[]
  items: PublicListItemRow[]
  /** The food a share publishes: what it is, how many, how heavy, and its
   *  order. Named columns only, like every other select here.
   *
   *  What stays private is the PLAN - day count, meal slots, "not needed"
   *  marks, packing state. Those live in other tables and no statement in
   *  this module reads them. "2 x 85 g ramen" is a thing in a pack;
   *  "Tuesday dinner: leftover curry" is a fact about someone's week. */
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

      // The food items table ALONE. Never join to list_food_item_slots
      // here: the associations say WHEN you plan to eat something, not how
      // much of it you carry, so a join would return one 500 g bag of trail
      // mix five times over for a trail mix scheduled across five lunches -
      // both as duplicate rows and, if anyone re-adds a sum, as 2500 g. The
      // slot tables are also the private half of the food plan, which is the
      // second reason nothing here touches them.
      const foodQuery = db
        .select({
          id: listFoodItems.id,
          name: listFoodItems.name,
          quantity: listFoodItems.quantity,
          weightGrams: listFoodItems.weightGrams,
          sortOrder: listFoodItems.sortOrder,
        })
        .from(listFoodItems)
        .innerJoin(lists, eq(lists.id, listFoodItems.listId))
        .where(shareGate)
        .orderBy(asc(listFoodItems.sortOrder))

      const [listRows, itemRows, categoryRows, foodRows] = await db.batch([
        listQuery,
        itemsQuery,
        categoriesQuery,
        foodQuery,
      ])

      const list = listRows[0]
      if (!list) return null
      return {
        list,
        categories: categoryRows,
        items: itemRows,
        food: foodRows,
      }
    },
  }
}

export type PublicSharesRepo = ReturnType<typeof createPublicSharesRepo>
