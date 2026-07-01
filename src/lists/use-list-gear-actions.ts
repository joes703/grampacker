import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  createCategory,
  nextCategorySortOrder,
  updateGearItem,
  deleteGearItem,
  makeOptimisticInsert,
} from '../lib/queries'
import {
  makeOptimisticGearItemUpdate,
  makeOptimisticGearItemDelete,
} from '../lib/queries/gear-list-items-fan-out'
import { randomTempId } from '../lib/random-temp-id'
import { showToast } from '../lib/toast'
import type { Category } from '../lib/types'

// Gear/category inventory writes reachable from ListDetailPage, lifted out of
// the page as the third ListDetailPage extraction slice (plan
// 2026-07-01-list-detail-f3), after useListResetActions (PR 1) and
// useListItemActions (PR 2). These write the shared inventory (gear_items /
// categories), not this list's per-trip rows:
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
// The gear mutations use the F1 gear-specific fan-out helpers
// (makeOptimisticGearItem{Update,Delete}), NOT the generic makeOptimistic*
// helpers: gear writes must propagate across both the ['gear-items'] cache and
// every affected ['list-items', *] cache. The delete keeps its explicit onError
// toast verbatim - a documented, mild deviation from the "optimistic rollback =
// no toast" policy that is preserved here, not "fixed", in a behavior-neutral
// refactor.
//
// The page keeps: the edit-gear dialog's sequential gear-then-list save
// orchestration and its saveError state, the delete-gear confirm + returnDialog
// restore, and all dialog/UI state. `categories` is read for addCategory's next
// sort order and optimistic placeholder, mirroring the prior inline closure.
export function useListGearActions(userId: string, categories: Category[]) {
  const qc = useQueryClient()

  // Editing gear from a list writes to gear_items so the change propagates to
  // the gear library and every list that embeds the same gear. The helper owns
  // both cache surfaces, including rollback and narrow invalidation.
  const gearUpdateHelper = makeOptimisticGearItemUpdate(qc)
  const updateGearItemMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateGearItem>[1] }) =>
      updateGearItem(id, patch),
    ...gearUpdateHelper,
  })

  // Delete a gear item entirely (gear library and every list that uses it).
  // The DB cascades list_items rows; the helper mirrors that immediately in
  // every affected list-items cache and rolls both surfaces back together. The
  // explicit onError toast is intentional and preserved verbatim.
  const deleteHelper = makeOptimisticGearItemDelete(qc)
  const deleteGearItemMut = useMutation({
    mutationFn: (id: string) => deleteGearItem(id),
    onMutate: deleteHelper.onMutate,
    onError: (err, vars, ctx) => {
      deleteHelper.onError(err, vars, ctx)
      showToast("Couldn't delete that item. Please try again.", { type: 'error' })
    },
    onSettled: deleteHelper.onSettled,
  })

  const addCategoryMut = useMutation({
    mutationFn: (name: string) => createCategory(userId, name, nextCategorySortOrder(categories)),
    ...makeOptimisticInsert<Category, string>({
      qc,
      queryKey: queryKeys.categories(),
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

  return {
    updateGearItem: updateGearItemMut,
    deleteGearItem: deleteGearItemMut,
    addCategory: addCategoryMut,
  }
}
