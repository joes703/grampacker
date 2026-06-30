import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  createCategory,
  updateCategory,
  deleteCategory,
  nextCategorySortOrder,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticDelete,
} from '../lib/queries'
import { randomTempId } from '../lib/random-temp-id'
import type { Category } from '../lib/types'

// Category write actions for GearLibraryPage, lifted out of the page following
// useGearItemActions (PR #154) and the FoodPlanDocument action-hook precedent.
// This is the second GearLibraryPage extraction slice: the three category write
// mutations (add / rename / delete) plus their optimistic wiring.
//
// The page keeps owning category REORDER (it lives in the useReorderable hook,
// colocated with DnD), the `commitNewCategory` glue, and the stable handler
// layer (handleRenameCategory / handleDeleteCategory read the referentially-
// stable .mutate). The add-category input and the delete-category confirm close
// at the mutate call site, exactly as before.
//
// `removeCategory` deletes only the category row. The DB cascades
// gear_items.category_id to NULL (ON DELETE SET NULL) - it does NOT delete the
// gear. Because that null-out is embedded in list_items via the gear join, the
// optimistic delete invalidates both the gear-items and list-items caches so
// open gear and list views re-render the now-uncategorized items once the
// round-trip settles. `categories` is read for the next sort slot and the
// optimistic insert placeholder, mirroring the prior inline closures verbatim.
export function useGearCategoryActions(userId: string, categories: Category[]) {
  const qc = useQueryClient()

  const addCategory = useMutation({
    mutationFn: (name: string) =>
      createCategory(userId, name, nextCategorySortOrder(categories)),
    ...makeOptimisticInsert<Category, string>({
      qc,
      queryKey: queryKeys.categories(),
      // Server assigns is_default=false for user-created categories
      // (defaults are seeded). Placeholder mirrors that.
      optimistic: (name) => ({
        id: `temp-${randomTempId()}`,
        user_id: userId,
        name,
        sort_order: nextCategorySortOrder(categories),
        is_default: false,
        created_at: new Date().toISOString(),
      }),
    }),
  })

  const renameCategory = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateCategory(id, { name }),
    ...makeOptimisticUpdate<Category, { id: string; name: string }>({
      qc,
      queryKey: queryKeys.categories(),
      id: ({ id }) => id,
      apply: (item, { name }) => ({ ...item, name }),
    }),
  })

  const removeCategory = useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    // Deleting a category cascades to gear_items.category_id (SET NULL), which is
    // embedded in list_items via the gear join - invalidate both side caches so
    // open gear / list views reflect the new uncategorized state once the
    // round-trip settles.
    ...makeOptimisticDelete<Category, string>({
      qc,
      queryKey: queryKeys.categories(),
      invalidateKeys: [queryKeys.gearItems(), queryKeys.listItemsAll()],
      id: (id) => id,
    }),
  })

  return { addCategory, renameCategory, removeCategory }
}
