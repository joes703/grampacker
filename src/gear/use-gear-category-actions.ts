import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  renameCategory as renameCategoryRequest,
  deleteCategory,
  makeOptimisticUpdate,
  makeOptimisticDelete,
} from '../lib/queries'
import { mutationKeys } from '../lib/queries/keys'
import { addCategoryMutationOptions } from '../lib/add-category-mutation'
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
    mutationKey: mutationKeys.addGearCategory(),
    ...addCategoryMutationOptions(qc, categories),
  })

  const renameCategory = useMutation({
    mutationKey: mutationKeys.renameGearCategory(),
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
    mutationKey: mutationKeys.removeGearCategory(),
    mutationFn: (id: string) => deleteCategory(id),
    // Toasted for the same reason as the gear-item delete: the section vanishes
    // and then returns, with the confirm already gone. Rename above stays silent -
    // its snap-back happens in the field the user just typed in.
    ...makeOptimisticDelete<Category, string>({
      qc,
      queryKey: queryKeys.categories(),
      invalidateKeys: [queryKeys.gearItems(), queryKeys.listItemsAll()],
      id: (id) => id,
    }),
    meta: { errorToast: "Couldn't confirm that category was deleted. Refresh to check before trying again." },
  })

  return { addCategory, renameCategory, removeCategory }
}
