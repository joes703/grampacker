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
// The bulk actions add an error toast (meta.errorToast) on top of the
// rollback: a bulk failure is otherwise easy to miss.
//
// The page keeps owning selection UI state: `selectMode`, `selectedIds`, and
// `exitSelectMode`. Select mode is exited on success at the mutate call site
// (via `onSuccess`), so a failure leaves the selection in place to retry - the
// hook stays a pure data hook and never touches selection state. The move
// dialog closes on the click (see its call site in GearLibraryPage.tsx).
export function useGearBulkActions() {
  const qc = useQueryClient()

  const bulkDelete = useMutation({
    mutationKey: mutationKeys.bulkDeleteGear(),
    mutationFn: (ids: string[]) => bulkDeleteGearItems(ids),
    ...makeOptimisticGearItemsBulkDelete({ qc }),
    meta: { errorToast: "Couldn't confirm the selected items were deleted. Refresh to check before trying again." },
  })

  const bulkMove = useMutation({
    mutationKey: mutationKeys.bulkMoveGear(),
    mutationFn: ({ ids, categoryId }: BulkMoveInput) =>
      bulkMoveToCategoryGearItems(ids, categoryId),
    ...makeOptimisticGearItemsBulkCategoryMove({ qc }),
    meta: { errorToast: "Couldn't confirm the selected items were moved. Try again, or refresh to check." },
  })

  return { bulkDelete, bulkMove }
}
