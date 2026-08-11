import { and, asc, eq, sql } from 'drizzle-orm'
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
  groupWorn: boolean
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

export type PublicShare = {
  list: PublicListRow
  categories: PublicCategoryRow[]
  items: PublicListItemRow[]
  /** Total grams of carried food, and NOTHING else about it. Names,
   *  quantities, day count, meal slots and packing state all stay private -
   *  "Tuesday dinner: leftover curry" says more about a person than "tent"
   *  does, and a share is anonymous.
   *
   *  It is published at all because the owner's own total counts food, so a
   *  share that omitted it reported a lighter pack for the same list. A
   *  number that disagrees with itself across two views is worse than an
   *  aggregate a reader can already estimate from the day count they cannot
   *  see. */
  foodWeightGrams: number
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
          groupWorn: lists.groupWorn,
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

      // Food's contribution as ONE number, summed over the food items table
      // alone. Never join to list_food_slots to get here: one 500 g bag of
      // trail mix scheduled across five lunches would return 2500 g. The
      // associations say WHEN you plan to eat something, not how much of it
      // you carry (see foodGramsFor in lib/weight-breakdown.ts, which is the
      // client-side statement of the same rule).
      const foodQuery = db
        .select({
          grams: sql<number>`coalesce(sum(${listFoodItems.weightGrams} * ${listFoodItems.quantity}), 0)`,
        })
        .from(listFoodItems)
        .innerJoin(lists, eq(lists.id, listFoodItems.listId))
        .where(shareGate)

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
        // sum() over zero rows is NULL, which coalesce already turns into 0;
        // the ?? covers the batch returning no aggregate row at all.
        foodWeightGrams: foodRows[0]?.grams ?? 0,
      }
    },
  }
}

export type PublicSharesRepo = ReturnType<typeof createPublicSharesRepo>
