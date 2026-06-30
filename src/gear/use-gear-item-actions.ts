import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  createGearItem,
  updateGearItem,
  deleteGearItem,
  nextGearItemSortOrder,
  makeOptimisticInsert,
} from '../lib/queries'
import {
  makeOptimisticGearItemUpdate,
  makeOptimisticGearItemDelete,
} from '../lib/queries/gear-list-items-fan-out'
import { randomTempId } from '../lib/random-temp-id'
import type { GearItem } from '../lib/types'

// Input shapes are derived from the gear query helpers, not from the dialog
// modules, so the action layer never depends on UI. `createGearItem`'s data arg
// is the 7-field gear patch; `updateGearItem`'s patch is its partial.
type CreateGearItemInput = Parameters<typeof createGearItem>[1]
type GearItemPatch = Parameters<typeof updateGearItem>[1]

// Gear-item write actions for GearLibraryPage, lifted out of the page following
// the FoodPlanDocument action-hook precedent (use-food-plan-*-actions). This is
// the first GearLibraryPage extraction slice: the three single gear-item write
// mutations (add / edit / delete) plus the optimistic + fan-out wiring they own.
//
// The page keeps owning `dialog` state, the stable row/section handler layer
// (it destructures the referentially-stable `editItem.mutate`), DnD/reorder,
// category/bulk mutations, import/export, and create-list-from-selection. The
// add/edit/delete dialogs close at the mutate call site via mutate-time
// `onSuccess`, exactly as before.
//
// `editItem` and `removeItem` compose the gear-specific fan-out helpers
// (`makeOptimisticGearItem*` from gear-list-items-fan-out), NOT the generic
// optimistic helpers: gear writes render from two cache surfaces (the account
// gear library and any open list view embedding the gear through
// list_items.gear_item), and those helpers own the cancel/snapshot/write/
// rollback/invalidate lifecycle across both. `allItems` is read for the next
// sort slot and the optimistic insert placeholder, mirroring the prior inline
// closures verbatim.
export function useGearItemActions(userId: string, allItems: GearItem[]) {
  const qc = useQueryClient()

  const addItem = useMutation({
    mutationFn: (data: CreateGearItemInput) =>
      createGearItem(userId, data, nextGearItemSortOrder(allItems)),
    ...makeOptimisticInsert<GearItem, CreateGearItemInput>({
      qc,
      queryKey: queryKeys.gearItems(),
      optimistic: (data) => {
        const now = new Date().toISOString()
        return {
          id: `temp-${randomTempId()}`,
          user_id: userId,
          category_id: data.category_id,
          name: data.name,
          description: data.description,
          weight_grams: data.weight_grams,
          cost: data.cost,
          purchase_date: data.purchase_date,
          status: data.status,
          sort_order: nextGearItemSortOrder(allItems),
          created_at: now,
          updated_at: now,
        }
      },
    }),
  })

  const editItem = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: GearItemPatch }) =>
      updateGearItem(id, patch),
    ...makeOptimisticGearItemUpdate(qc),
  })

  const removeItem = useMutation({
    mutationFn: (id: string) => deleteGearItem(id),
    ...makeOptimisticGearItemDelete(qc),
  })

  return { addItem, editItem, removeItem }
}
