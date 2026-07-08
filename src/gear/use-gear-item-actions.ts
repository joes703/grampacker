import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  createGearItem,
  updateGearItem,
  deleteGearItem,
  nextGearItemSortOrder,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticDelete,
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
// TRANSPLANT NOTE (phase 3 will revisit): the old repo composed the
// gear-list-items fan-out helpers here because gear writes rendered from
// two cache surfaces (the gear library AND any list embedding the gear
// through list_items.gear_item). Lists don't exist yet in this codebase,
// so edit/delete use the generic single-cache helpers; when the lists
// slice transplants, the fan-out module comes with it and these two
// mutations switch back.
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
    ...makeOptimisticUpdate<GearItem, { id: string; patch: GearItemPatch }>({
      qc,
      queryKey: queryKeys.gearItems(),
      id: (input) => input.id,
      // PATCH semantics: undefined = unchanged; strip undefined so the
      // spread cannot overwrite a field with it.
      apply: (item, { patch }) => {
        const next = { ...item }
        for (const [key, value] of Object.entries(patch)) {
          if (value !== undefined) {
            ;(next as Record<string, unknown>)[key] = value
          }
        }
        return next
      },
    }),
  })

  const removeItem = useMutation({
    mutationFn: (id: string) => deleteGearItem(id),
    ...makeOptimisticDelete<GearItem, string>({
      qc,
      queryKey: queryKeys.gearItems(),
      id: (input) => input,
    }),
  })

  return { addItem, editItem, removeItem }
}
