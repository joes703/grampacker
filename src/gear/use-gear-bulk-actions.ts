import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  bulkDeleteGearItems,
  bulkMoveToCategoryGearItems,
  makeOptimisticBulkDelete,
  makeOptimisticBulkUpdate,
} from '../lib/queries'
import type { GearItem } from '../lib/types'

// Input for the bulk category move: the selected gear ids and the destination
// category (null clears the category). Defined here so the action layer never
// imports the toolbar/dialog UI modules just for a type.
type BulkMoveInput = { ids: string[]; categoryId: string | null }

// Bulk gear write actions for GearLibraryPage: the two multi-select bulk
// mutations (delete selected / move selected to a category) plus their
// optimistic wiring and error feedback.
//
// TRANSPLANT NOTE (phase 3 will revisit): the old repo composed the
// gear-list-items BULK fan-out helpers here because bulk gear writes
// rendered from two cache surfaces (the gear library AND any open list view
// embedding the gear through list_items.gear_item). Lists don't exist yet
// in this codebase, so both mutations use the generic bulk helpers on the
// single gearItems cache; when the lists slice transplants, the fan-out
// module comes with it and these switch back.
//
// Unlike the single-item mutations (whose silent rollback is the only
// failure signal), the bulk actions layer an explicit error toast on top of
// the rollback - a bulk failure is otherwise easy to miss - via the
// helpers' errorToast option.
//
// The page keeps owning selection UI state: `selectMode`, `selectedIds`, and
// `exitSelectMode`. Select mode is exited on success at the mutate call site
// (via `onSuccess`), matching how the item/category dialogs close there - the
// hook stays a pure data hook and never touches selection state.
export function useGearBulkActions() {
  const qc = useQueryClient()

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteGearItems(ids),
    ...makeOptimisticBulkDelete<GearItem, string[]>({
      qc,
      queryKey: queryKeys.gearItems(),
      errorToast: "Couldn't delete the selected items. Please try again.",
      ids: (ids) => ids,
    }),
  })

  const bulkMove = useMutation({
    mutationFn: ({ ids, categoryId }: BulkMoveInput) =>
      bulkMoveToCategoryGearItems(ids, categoryId),
    ...makeOptimisticBulkUpdate<GearItem, BulkMoveInput>({
      qc,
      queryKey: queryKeys.gearItems(),
      errorToast: "Couldn't move the selected items. Please try again.",
      ids: ({ ids }) => ids,
      apply: (item, { categoryId }) => ({ ...item, categoryId }),
    }),
  })

  return { bulkDelete, bulkMove }
}
