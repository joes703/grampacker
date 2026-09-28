import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  bulkDeleteGearItems,
  bulkMoveToCategoryGearItems,
  makeOptimisticGearItemsBulkDelete,
  makeOptimisticGearItemsBulkCategoryMove,
} from '../lib/queries'
import { mutationKeys } from '../lib/queries/keys'

// Input for the bulk category move: the selected gear ids and the destination
// category (null clears the category). Defined here so the action layer never
// imports the toolbar/dialog UI modules just for a type.
type BulkMoveInput = { ids: string[]; categoryId: string | null }

// Bulk gear write actions for GearLibraryPage: the two multi-select bulk
// mutations (delete selected / move selected to a category) plus their
// optimistic wiring and error feedback.
//
// Both mutations render from two cache surfaces (the gear library AND any
// open list view embedding the gear through list_items.gearItem), so they
// use the gear-list-items BULK fan-out helpers.
//
// Unlike the single-item mutations (whose silent rollback is the only
// failure signal), the bulk actions layer an explicit error toast on top of
// the rollback - a bulk failure is otherwise easy to miss - via the
// helpers' errorToast option.
//
// The page keeps owning selection UI state: `selectMode`, `selectedIds`, and
// `exitSelectMode`. Select mode is exited on success at the mutate call site
// (via `onSuccess`), so a failure leaves the selection in place to retry - the
// hook stays a pure data hook and never touches selection state. The move
// dialog closes on the click instead, so the error toast is not hidden behind
// it (the modal rule in src/lib/mutation-error-handler.ts).
export function useGearBulkActions() {
  const qc = useQueryClient()

  const bulkDelete = useMutation({
    mutationKey: mutationKeys.bulkDeleteGear(),
    mutationFn: (ids: string[]) => bulkDeleteGearItems(ids),
    ...makeOptimisticGearItemsBulkDelete({
      qc,
      errorToast: "Couldn't delete the selected items. Please try again.",
    }),
  })

  const bulkMove = useMutation({
    mutationKey: mutationKeys.bulkMoveGear(),
    mutationFn: ({ ids, categoryId }: BulkMoveInput) =>
      bulkMoveToCategoryGearItems(ids, categoryId),
    ...makeOptimisticGearItemsBulkCategoryMove({
      qc,
      errorToast: "Couldn't move the selected items. Please try again.",
    }),
  })

  return { bulkDelete, bulkMove }
}
