import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import {
  categories,
  gearItems,
  listItems,
  lists,
} from '../db/schema'

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

      const [listRows, itemRows, categoryRows] = await db.batch([
        listQuery,
        itemsQuery,
        categoriesQuery,
      ])

      const list = listRows[0]
      if (!list) return null
      return {
        list,
        categories: categoryRows,
        items: itemRows,
      }
    },
  }
}

export type PublicSharesRepo = ReturnType<typeof createPublicSharesRepo>
