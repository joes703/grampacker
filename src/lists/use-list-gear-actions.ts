import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  createCategory,
  nextCategorySortOrder,
  updateGearItem,
  deleteGearItem,
  makeOptimisticInsert,
  makeOptimisticGearItemUpdate,
  makeOptimisticGearItemDelete,
} from '../lib/queries'
import { mutationKeys } from '../lib/queries/keys'
import { randomTempId } from '../lib/random-temp-id'
import type { Category } from '../lib/types'

// Gear/category inventory writes reachable from ListDetailPage. These write
// the shared inventory (gear_items / categories), not this list's per-trip
// rows:
//   updateGearItem - edit a gear item from the list (name/description/weight/
//                    status/category); fans out to every ['list-items', *]
//                    cache that embeds it.
//   deleteGearItem - remove a gear item from inventory; the DB cascades its
//                    list_items and the fan-out mirrors that in every cache.
//   addCategory    - create a category (used by the edit-gear dialog's
//                    "create category" affordance).
//
// All three return RAW useMutation objects so the page's memoized handler layer
// (sharedGroupProps.onSaveGear*/onSetGearStatus, the edit-gear dialog, the
// delete-gear confirm) keeps reading the referentially-stable `.mutate` through
// the live binding with []-deps - the wrapper object is fresh each render but
// `.mutate` is stable. Do NOT wrap these in callbacks here; that defeats the
// memo boundary.
//
// The gear mutations use the gear-specific fan-out helpers
// (makeOptimisticGearItem{Update,Delete}), NOT the generic makeOptimistic*
// helpers: gear writes must propagate across both the ['gear-items'] cache and
// every affected ['list-items', *] cache. The delete carries an explicit error
// toast (via the helper's errorToast option) and the edit does not. That used to
// be recorded here as an unexplained deviation "preserved, not fixed"; it is now
// an instance of the stated rule in src/lib/mutation-error-handler.ts - a delete's
// snap-back is a row reappearing after the confirm has closed, an edit's happens
// in place under the cursor. The gear library's own delete
// (src/gear/use-gear-item-actions.ts) carries the same copy for the same event.
//
// The page keeps: the edit-gear dialog's sequential gear-then-list save
// orchestration and its saveError state, the delete-gear confirm + returnDialog
// restore, and all dialog/UI state. `categories` is read for addCategory's
// optimistic placeholder slot, mirroring the prior inline closure; the SERVER
// assigns the persisted sortOrder on create.
export function useListGearActions(categories: Category[]) {
  const qc = useQueryClient()

  // Editing gear from a list writes to gear_items so the change propagates to
  // the gear library and every list that embeds the same gear. The helper owns
  // both cache surfaces, including rollback and narrow invalidation.
  const updateGearItemMut = useMutation({
    mutationKey: mutationKeys.updateGearFromList(),
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateGearItem>[1] }) =>
      updateGearItem(id, patch),
    ...makeOptimisticGearItemUpdate({ qc }),
  })

  // Delete a gear item entirely (gear library and every list that uses it).
  // The DB cascades list_items rows; the helper mirrors that immediately in
  // every affected list-items cache and rolls both surfaces back together.
  const deleteGearItemMut = useMutation({
    mutationKey: mutationKeys.deleteGearFromList(),
    mutationFn: (id: string) => deleteGearItem(id),
    ...makeOptimisticGearItemDelete({
      qc,
      errorToast: "Couldn't confirm that item was deleted. Refresh to check before trying again.",
    }),
  })

  const addCategoryMut = useMutation({
    mutationKey: mutationKeys.addCategoryFromList(),
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

  return {
    updateGearItem: updateGearItemMut,
    deleteGearItem: deleteGearItemMut,
    addCategory: addCategoryMut,
  }
}
