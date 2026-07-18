import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import {
  categories,
  foodItems,
  foodPlanEntries,
  gearItems,
  listItems,
  lists,
} from '../db/schema'
import type { ProjectionEntry } from '../../shared/food-projection'

// Anonymous read access for the public share surface (/api/shares/:slug).
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
  // The attached plan's entries pre-joined to their food's projection inputs
  // (design 5.2), for the route to fold into ONE weight via the canonical
  // shared/food-projection.ts. null = no plan attached - presence is encoded
  // here so the route can tell it apart from an attached plan with zero
  // entries (design 7). Never handed out raw: basis/amount/serving data must
  // not reach the wire.
  foodEntries: ProjectionEntry[] | null
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
          // Repo-internal: encodes food presence (null vs zero-entry plan)
          // and never leaves this function - the return strips it below.
          foodPlanId: lists.foodPlanId,
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

      // The attached plan's entries with each food's projection inputs
      // (design 5.2/7). Resolved through the lists join on food_plan_id with
      // the same share gate - one bound-param pair regardless of plan size
      // (no inArray; D1 caps bound params at 100), zero rows when no plan is
      // attached OR the plan is empty (the list row's foodPlanId
      // disambiguates those two below), and self-gated so an unshare cannot
      // interleave. Order is irrelevant: projection is a commutative fold.
      const foodEntriesQuery = db
        .select({
          basis: foodPlanEntries.basis,
          amount: foodPlanEntries.amount,
          servingWeightGrams: foodItems.servingWeightGrams,
          servingsPerPackage: foodItems.servingsPerPackage,
        })
        .from(foodPlanEntries)
        .innerJoin(foodItems, eq(foodItems.id, foodPlanEntries.foodItemId))
        .innerJoin(lists, eq(lists.foodPlanId, foodPlanEntries.foodPlanId))
        .where(shareGate)

      const [listRows, itemRows, categoryRows, foodEntryRows] = await db.batch([
        listQuery,
        itemsQuery,
        categoriesQuery,
        foodEntriesQuery,
      ])

      const list = listRows[0]
      if (!list) return null
      const { foodPlanId, ...publicList } = list
      return {
        list: publicList,
        categories: categoryRows,
        items: itemRows,
        foodEntries: foodPlanId === null ? null : foodEntryRows,
      }
    },
  }
}

export type PublicSharesRepo = ReturnType<typeof createPublicSharesRepo>
