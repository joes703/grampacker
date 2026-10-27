import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  createGearItem,
  updateGearItem,
  deleteGearItem,
  nextSortOrder,
  makeOptimisticInsert,
  makeOptimisticGearItemUpdate,
  makeOptimisticGearItemDelete,
} from '../lib/queries'
import { mutationKeys } from '../lib/queries/keys'
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
// nextSortOrder computes the same value against the cached rows so
// the placeholder lands where the server row will (the settled refetch
// reconciles any race).
export function useGearItemActions(allItems: GearItem[]) {
  const qc = useQueryClient()

  const addItem = useMutation({
    mutationKey: mutationKeys.addGearItem(),
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
          sortOrder: nextSortOrder(allItems),
          createdAt: now,
          updatedAt: now,
        }
      },
    }),
  })

  const editItem = useMutation({
    mutationKey: mutationKeys.editGearItem(),
    mutationFn: ({ id, patch }: { id: string; patch: GearItemPatch }) =>
      updateGearItem(id, patch),
    // Fans the patch out to every list cache embedding this gear; the
    // undefined-stripping PATCH merge lives inside the helper.
    ...makeOptimisticGearItemUpdate({ qc }),
  })

  const removeItem = useMutation({
    mutationKey: mutationKeys.removeGearItem(),
    mutationFn: (id: string) => deleteGearItem(id),
    // The server cascades list_items on gear delete; the fan-out mirrors
    // that by dropping the membership rows optimistically too.
    //
    // Toasted, unlike the edit above: a failed delete snaps back as a row
    // REAPPEARING somewhere in a long library, after the confirm has closed - the
    // easy-to-miss case the rule in src/lib/mutation-error-handler.ts names. Same
    // copy as the identical delete initiated from a list
    // (src/lists/use-list-gear-actions.ts), because it is the same event.
    //
    // "Couldn't confirm", not "couldn't delete", and not "try again". A rejected
    // request never proves the server did not commit, and this route is not
    // response-idempotent: if the DELETE landed and only the response was lost, the
    // rollback has just put a row back that no longer exists, and retrying answers
    // 404. Refreshing is the only thing that settles it.
    ...makeOptimisticGearItemDelete({
      qc,
    }),
    meta: { errorToast: "Couldn't confirm that item was deleted. Refresh to check before trying again." },
  })

  return { addItem, editItem, removeItem }
}
