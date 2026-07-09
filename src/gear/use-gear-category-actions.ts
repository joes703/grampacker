import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  createCategory,
  renameCategory as renameCategoryRequest,
  deleteCategory,
  nextCategorySortOrder,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticDelete,
} from '../lib/queries'
import { randomTempId } from '../lib/random-temp-id'
import type { Category } from '../lib/types'

// Category write actions for GearLibraryPage: the three category write
// mutations (add / rename / delete) plus their optimistic wiring.
//
// The page keeps owning category REORDER (it lives in the useReorderable
// hook, colocated with DnD), the `commitNewCategory` glue, and the stable
// handler layer.
//
// `removeCategory` deletes only the category row; the server uncategorizes
// the category's gear in the same transaction (the SQLite port of the old
// ON DELETE SET NULL cascade), so the optimistic delete invalidates the
// gear-items cache for open gear views to re-render the now-uncategorized
// items once the round-trip settles. Every per-list cache embeds the full
// gear DTO through list_items.gearItem, so those copies go stale for the
// same reason; the list-items prefix invalidation refreshes them all.
// `categories` seeds the optimistic placeholder's sort slot - the server
// assigns the real sortOrder (max+1) and the placeholder computes the same
// value from the cached rows.
export function useGearCategoryActions(categories: Category[]) {
  const qc = useQueryClient()

  const addCategory = useMutation({
    mutationFn: (name: string) => createCategory(name),
    ...makeOptimisticInsert<Category, string>({
      qc,
      queryKey: queryKeys.categories(),
      optimistic: (name) => ({
        id: `temp-${randomTempId()}`,
        name,
        sortOrder: nextCategorySortOrder(categories),
        createdAt: new Date().toISOString(),
      }),
    }),
  })

  const renameCategory = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameCategoryRequest(id, name),
    ...makeOptimisticUpdate<Category, { id: string; name: string }>({
      qc,
      queryKey: queryKeys.categories(),
      id: ({ id }) => id,
      apply: (item, { name }) => ({ ...item, name }),
    }),
  })

  const removeCategory = useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    ...makeOptimisticDelete<Category, string>({
      qc,
      queryKey: queryKeys.categories(),
      invalidateKeys: [queryKeys.gearItems(), queryKeys.listItemsAll()],
      id: (id) => id,
    }),
  })

  return { addCategory, renameCategory, removeCategory }
}
