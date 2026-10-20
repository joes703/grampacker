import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  addListItem,
  quickAddListItem,
  updateListItem,
  deleteListItem,
  nextListItemSortOrder,
  makeOptimisticInsert,
  makeOptimisticDelete,
  type ListItemPatch,
} from '../lib/queries'
import { arrayShape, fieldScopedCache } from '../lib/queries/field-scoped'
import { mutationKeys } from '../lib/queries/keys'
import { showToast } from '../lib/toast'
import { nextUnionPackRankFor } from './pack-rows'
import type { FoodItemResponse } from '../../shared/food'
import { randomTempId } from '../lib/random-temp-id'
import type { GearItem, ListItemWithGear } from '../lib/types'
import { type AddItemData } from './use-quick-add-form'

type MoveItemVars = {
  itemId: string
  locationId: string | null
  nextPackSortOrder: number
}

// List-item write actions for ListDetailPage, lifted out of the page
// following the GearLibraryPage precedent. These are the ways the user
// changes THIS list's contents:
//   addItem     - add an EXISTING gear item to the list (LibraryPanel)
//   addNewItem  - Quick Add: create a new gear_item + list_item atomically
//   updateItem  - patch per-list-item fields (quantity/worn/consumable/packed/ready)
//   moveItem    - move an item between packing locations
//   deleteItem  - remove an item from the list
//
// All of them return RAW useMutation objects so the page's memoized handler layer
// (sharedGroupProps, onLibraryAdd/Remove, onAddNewItem) can keep reading the
// referentially-stable `.mutate` through the live binding with []-deps - the
// mutation wrapper is fresh each render but `.mutate` is stable. Do NOT wrap
// these in callbacks here; that would defeat the memo boundary.
//
// `updateItem` carries a sibling-in-flight invalidation gate with
// last-one-out semantics: two parallel updates (e.g. tapping Packed then
// Ready quickly) each carry their own PATCH; letting an early settle
// invalidate would race a sibling write and overwrite its optimistic value
// with stale server data. The LAST update to settle DOES invalidate, so
// every burst re-converges with server truth - see the mutation for the
// full lifecycle rationale.
//
// The page keeps: the addingNewItemRef double-fire guard (a UI/event concern),
// dialog orchestration, DnD/reorder, gear/category/notes/ready-checks mutations,
// and all UI state. `listItems` is read for the next sort slot and the add
// optimistic placeholder, mirroring the prior inline closures. The SERVER
// assigns the persisted sortOrder on every create; the client-side slot only
// positions the placeholder where the server row will land.
export function useListItemActions(
  listId: string,
  {
    listItems,
    foodItems,
  }: {
    listItems: ListItemWithGear[]
    // The placeholder pack rank is one past the Unassigned UNION maximum
    // (0022: gear and food share the rank space), mirroring the server's
    // nextUnionPackRank - a gear-only maximum would park the placeholder
    // above food already sitting in Unassigned for the frame before the
    // settled refetch corrected it.
    foodItems: FoodItemResponse[]
  },
) {
  const qc = useQueryClient()

  // Field-scoped access to this list's items cache (snapshot only the touched
  // fields; restore onto the CURRENT row): src/lib/queries/field-scoped.ts.
  const listItemsCache = fieldScopedCache(
    qc,
    queryKeys.listItems(listId),
    arrayShape<ListItemWithGear>(),
  )

  const addItem = useMutation({
    mutationKey: mutationKeys.addListItem(listId),
    mutationFn: (item: GearItem) => addListItem(listId, item.id),
    ...makeOptimisticInsert<ListItemWithGear, GearItem>({
      qc,
      queryKey: queryKeys.listItems(listId),
      optimistic: (item) => {
        const now = new Date().toISOString()
        return {
          // Temp id replaced by the server row on settled refetch. The
          // randomTempId() suffix avoids any collision with real ids.
          id: `temp-${randomTempId()}`,
          listId,
          gearItemId: item.id,
          // The new DTO embeds the FULL gear response (the old repo's
          // 7-column projection grew to the whole row in the rewrite),
          // and GearItem IS that shape - embed it as-is.
          gearItem: item,
          quantity: 1,
          isWorn: false,
          isConsumable: false,
          isPacked: false,
          isReady: false,
          packingLocationId: null,
          sortOrder: nextListItemSortOrder(listItems),
          // A new item is Unassigned, so its placeholder rank comes from that
          // cohort - mirroring what the server assigns. Reusing the document
          // rank here would put the row in the wrong place in Pack for the one
          // frame before the settled refetch corrects it.
          packSortOrder: nextUnionPackRankFor(listItems, foodItems, null),
          createdAt: now,
          updatedAt: now,
        }
      },
    }),
  })

  // FIELD-SCOPED instead of makeOptimisticUpdate: the generic helper
  // snapshots and restores the WHOLE cached array, so a failing patch's
  // rollback would wipe every concurrent sibling's successful optimistic
  // write (fail Packed while Ready succeeds on the same item -> the Ready
  // tick vanishes). fieldScopedCache.patchRow/restoreRow compose instead.
  //
  // patchRow's cancel is awaited, like the shared helpers in
  // lib/queries/optimistic.ts: this is a checkbox tap (Packed / Ready), not
  // a drag, so there is no drop animation that needs the write to land in
  // the same tick - the reason reorder alone stays sync.
  //
  // mutationKey drives the last-one-out invalidation gate in onSettled. Two
  // parallel updateItem calls (e.g. tapping Packed then Ready in quick
  // succession) each carry their own PATCH; an invalidate fired while a
  // sibling is still pending can refetch stale server data over the
  // sibling's optimistic write. In TanStack Query v5, onSettled runs before
  // the settling mutation leaves the pending set, so the settling mutation
  // counts ITSELF in qc.isMutating - the "siblings still pending" check is
  // therefore `> 1`, and exactly one invalidate fires per burst, after the
  // final PATCH settles. That trailing refetch is what re-converges the
  // cache with server truth when something external raced the optimistic
  // writes (e.g. the edit-gear dialog saves gear first, whose fan-out
  // invalidation refetches this list mid-save).
  const updateMutKey = mutationKeys.updateListItem(listId)
  const updateItem = useMutation({
    mutationKey: updateMutKey,
    mutationFn: ({ itemId, patch }: { itemId: string; patch: ListItemPatch }) =>
      updateListItem(listId, itemId, patch),
    onMutate: ({ itemId, patch }: { itemId: string; patch: ListItemPatch }) =>
      listItemsCache.patchRow(itemId, patch),
    onError: (_err, { itemId }, prevFields) => {
      if (prevFields) listItemsCache.restoreRow(itemId, prevFields)
    },
    onSettled: () => {
      // `> 1` = true siblings still pending (the settling mutation counts
      // itself); the last one out invalidates once for the whole burst.
      if (qc.isMutating({ mutationKey: updateMutKey }) > 1) return
      void qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    },
  })

  // Moving an item between packing locations: the write behind both a
  // cross-location drag and the row menu's "Move to".
  //
  // Field-scoped like updateItem above and moveFood (use-list-food.ts): a failed
  // move rewinds ONLY the moved row's location + rank, onto the CURRENT row.
  // makeOptimisticUpdate would restore the whole array as it was when the move
  // started, which also undoes any other write that landed in the meantime - a
  // Packed tick on another row that the server has already saved disappears,
  // and under "Unpacked only" the finished row comes back.
  //
  // nextPackSortOrder mirrors the rank the server assigns a move (repo
  // `nextPackSortOrderInCohort`). Applying only the assignment would park the
  // row at its OLD rank until the refetch landed, so it would appear at some
  // arbitrary depth of its new location and then visibly jump to the bottom a
  // moment later. The caller computes it, because the rank depends on every
  // row in the destination. sortOrder is deliberately untouched: a move
  // rearranges your pack, not your document.
  const moveItem = useMutation({
    mutationKey: mutationKeys.moveListItem(listId),
    mutationFn: ({ itemId, locationId }: MoveItemVars) =>
      updateListItem(listId, itemId, { packingLocationId: locationId }),
    onMutate: ({ itemId, locationId, nextPackSortOrder }: MoveItemVars) =>
      listItemsCache.patchRow(itemId, {
        packingLocationId: locationId,
        packSortOrder: nextPackSortOrder,
      }),
    onError: (_err, { itemId }, previousPlacement) => {
      if (previousPlacement) listItemsCache.restoreRow(itemId, previousPlacement)
      // Toasted for the reorder reason rather than the delete one (see the rule
      // in src/lib/mutation-error-handler.ts): this is the write behind a DRAG,
      // and a rollback that sends the row back where it came from is
      // indistinguishable from the user having dragged it back themselves. The
      // row-menu "Move to" path shares the mutation and is no more obvious.
      showToast("Couldn't move that item. Please try again.", { type: 'error' })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    },
  })

  // invalidateKeys covers a cascade the client cannot see locally: a list item
  // can BACK a packing location, and packing_locations.container_list_item_id
  // is ON DELETE CASCADE, so deleting such a row deletes the location server-
  // side (and SET NULLs its contents' packing_location_id). Without the second
  // invalidation the packing-locations cache kept serving a location whose
  // backing row no longer exists, and the pack view rendered a ghost section
  // until something else happened to refetch it.
  const deleteItem = useMutation({
    mutationKey: mutationKeys.deleteListItem(listId),
    mutationFn: (itemId: string) => deleteListItem(listId, itemId),
    // Toasted per the rule in src/lib/mutation-error-handler.ts. Both routes here
    // are easy to miss: the confirm path closes before mutating, and the pristine
    // path removes with no confirm at all, so the only other evidence of failure
    // is a row quietly returning to a long list.
    ...makeOptimisticDelete<ListItemWithGear, string>({
      qc,
      queryKey: queryKeys.listItems(listId),
      id: (itemId) => itemId,
      // listFood too (0022): deleting a container-backing row deletes its
      // location, whose SET NULL + rerank cascade now moves FOOD rows as
      // well as gear.
      invalidateKeys: [queryKeys.packingLocations(listId), queryKeys.listFood(listId)],
      errorToast: "Couldn't confirm that item was removed. Refresh to check before trying again.",
    }),
  })

  // Quick Add creates a gear_item (so it also lands in the gear library) and
  // the matching list_item together in one atomic server call. NON-optimistic:
  // pure cache-invalidate on success (both the gear and this list's items),
  // with a meta.errorToast for the failure path. cost/purchaseDate are out of
  // scope for Quick Add and fixed at null by the server.
  const addNewItem = useMutation({
    mutationKey: mutationKeys.addNewListItem(listId),
    mutationFn: ({ categoryId, data }: { categoryId: string | null; data: AddItemData }) =>
      quickAddListItem(listId, {
        name: data.name,
        description: data.description,
        weightGrams: data.weightGrams,
        categoryId,
        quantity: data.quantity,
        isWorn: data.isWorn,
        isConsumable: data.isConsumable,
      }),
    meta: { errorToast: "Couldn't add that item. Please try again." },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      void qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    },
  })

  return { addItem, updateItem, moveItem, deleteItem, addNewItem }
}
