import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bulkDeleteGearItems, bulkMoveToCategoryGearItems } from '../lib/queries'
import {
  makeOptimisticGearItemsBulkDelete,
  makeOptimisticGearItemsBulkCategoryMove,
} from '../lib/queries/gear-list-items-fan-out'
import { showToast } from '../lib/toast'

// Input for the bulk category move: the selected gear ids and the destination
// category (null clears the category). Defined here so the action layer never
// imports the toolbar/dialog UI modules just for a type.
type BulkMoveInput = { ids: string[]; categoryId: string | null }

// Bulk gear write actions for GearLibraryPage, lifted out of the page following
// useGearItemActions (PR #154) and useGearCategoryActions (PR #155). This is the
// third GearLibraryPage extraction slice: the two multi-select bulk mutations
// (delete selected / move selected to a category) plus their fan-out wiring and
// error feedback.
//
// These compose the gear-specific BULK fan-out helpers
// (makeOptimisticGearItemsBulk{Delete,CategoryMove}), NOT the generic optimistic
// helpers: bulk gear writes render from two cache surfaces (the account gear
// library and any open list view embedding the gear through
// list_items.gear_item), and those helpers own the cancel/snapshot/write/
// rollback/invalidate lifecycle across both. Unlike the single-item mutations
// (whose silent rollback is the only failure signal), the bulk actions layer an
// explicit error toast on top of that rollback - a bulk failure is otherwise
// easy to miss - so onError runs the helper's rollback AND surfaces a toast.
//
// The page keeps owning selection UI state: `selectMode`, `selectedIds`, and
// `exitSelectMode`. Select mode is exited on success at the mutate call site
// (via `onSuccess`), matching how the item/category dialogs close there - the
// hook stays a pure data hook and never touches selection state.
export function useGearBulkActions() {
  const qc = useQueryClient()

  const bulkDeleteHelper = makeOptimisticGearItemsBulkDelete(qc)
  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteGearItems(ids),
    onMutate: bulkDeleteHelper.onMutate,
    onError: (err, vars, ctx) => {
      bulkDeleteHelper.onError(err, vars, ctx)
      showToast("Couldn't delete the selected items. Please try again.", { type: 'error' })
    },
    onSettled: bulkDeleteHelper.onSettled,
  })

  const bulkMoveHelper = makeOptimisticGearItemsBulkCategoryMove(qc)
  const bulkMove = useMutation({
    mutationFn: ({ ids, categoryId }: BulkMoveInput) =>
      bulkMoveToCategoryGearItems(ids, categoryId),
    onMutate: bulkMoveHelper.onMutate,
    onError: (err, vars, ctx) => {
      bulkMoveHelper.onError(err, vars, ctx)
      showToast("Couldn't move the selected items. Please try again.", { type: 'error' })
    },
    onSettled: bulkMoveHelper.onSettled,
  })

  return { bulkDelete, bulkMove }
}
