import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  createGearItem,
  updateGearItem,
  deleteGearItem,
  nextGearItemSortOrder,
  makeOptimisticInsert,
  makeOptimisticGearItemUpdate,
  makeOptimisticGearItemDelete,
} from '../lib/queries'
import { randomTempId } from '../lib/random-temp-id'
import type { GearItem } from '../lib/types'

// Input shapes are derived from the gear query helpers, not from the dialog
// modules, so the action layer never depends on UI.
type CreateGearItemInput = Parameters<typeof createGearItem>[0]
type GearItemPatch = Parameters<typeof updateGearItem>[1]

// Gear-item write actions for GearLibraryPage: the three single gear-item
// write mutations (add / edit / delete) plus their optimistic wiring.
//
// Edit and delete render from two cache surfaces (the gear library AND
// any open list view embedding the gear through list_items.gearItem), so
// they use the gear-list-items fan-out helpers; insert stays on the
// generic single-cache helper because a brand-new gear item cannot be in
// any list yet.
//
// `allItems` seeds the optimistic insert placeholder's sort slot. The
// SERVER assigns the real sortOrder on create (max+1); the client-side
// nextGearItemSortOrder computes the same value against the cached rows so
// the placeholder lands where the server row will (the settled refetch
// reconciles any race).
export function useGearItemActions(allItems: GearItem[]) {
  const qc = useQueryClient()

  const addItem = useMutation({
    mutationFn: (data: CreateGearItemInput) => createGearItem(data),
    ...makeOptimisticInsert<GearItem, CreateGearItemInput>({
      qc,
      queryKey: queryKeys.gearItems(),
      optimistic: (data) => {
        const now = new Date().toISOString()
        return {
          id: `temp-${randomTempId()}`,
          categoryId: data.categoryId ?? null,
          name: data.name,
          description: data.description ?? null,
          weightGrams: data.weightGrams ?? 0,
          cost: data.cost ?? null,
          purchaseDate: data.purchaseDate ?? null,
          status: data.status ?? 'active',
          sortOrder: nextGearItemSortOrder(allItems),
          createdAt: now,
          updatedAt: now,
        }
      },
    }),
  })

  const editItem = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: GearItemPatch }) =>
      updateGearItem(id, patch),
    // Fans the patch out to every list cache embedding this gear; the
    // undefined-stripping PATCH merge lives inside the helper.
    ...makeOptimisticGearItemUpdate({ qc }),
  })

  const removeItem = useMutation({
    mutationFn: (id: string) => deleteGearItem(id),
    // The server cascades list_items on gear delete; the fan-out mirrors
    // that by dropping the membership rows optimistically too.
    ...makeOptimisticGearItemDelete({ qc }),
  })

  return { addItem, editItem, removeItem }
}
