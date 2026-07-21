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
import { randomTempId } from '../lib/random-temp-id'
import type { GearItem, ListItemWithGear } from '../lib/types'
import { type AddItemData } from './use-quick-add-form'

// List-item write actions for ListDetailPage, lifted out of the page
// following the GearLibraryPage precedent. These are the four ways the user
// changes THIS list's contents:
//   addItem     - add an EXISTING gear item to the list (LibraryPanel)
//   addNewItem  - Quick Add: create a new gear_item + list_item atomically
//   updateItem  - patch per-list-item fields (quantity/worn/consumable/packed/ready)
//   deleteItem  - remove an item from the list
//
// All four return RAW useMutation objects so the page's memoized handler layer
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
  { listItems }: { listItems: ListItemWithGear[] },
) {
  const qc = useQueryClient()

  const addItem = useMutation({
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
          createdAt: now,
          updatedAt: now,
        }
      },
    }),
  })

  // Hand-rolled FIELD-SCOPED optimistic lifecycle instead of
  // makeOptimisticUpdate: the generic helper snapshots and restores the
  // WHOLE cached array, so a failing patch's rollback would wipe every
  // concurrent sibling's successful optimistic write (fail Packed while
  // Ready succeeds on the same item -> the Ready tick vanishes). Here
  // onMutate snapshots only the fields THIS patch touches and onError
  // restores only those fields onto the CURRENT row, so concurrent patches
  // compose - the same pattern as use-list-reset-actions' field-scoped
  // rollbacks.
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
  const updateMutKey = ['update-list-item', listId] as const
  const updateItem = useMutation({
    mutationKey: updateMutKey,
    mutationFn: ({ itemId, patch }: { itemId: string; patch: ListItemPatch }) =>
      updateListItem(listId, itemId, patch),
    onMutate: async ({ itemId, patch }: { itemId: string; patch: ListItemPatch }) => {
      // Awaited, like the shared helpers in lib/queries/optimistic.ts: an
      // unawaited cancel lets an in-flight refetch resolve after the optimistic
      // write and clobber it with stale server state. This is a checkbox tap
      // (Packed / Ready), not a drag, so there is no drop animation that needs the
      // write to land in the same tick - the reason reorder alone stays sync.
      await qc.cancelQueries({ queryKey: queryKeys.listItems(listId) })
      const rows = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems(listId))
      const row = rows?.find((i) => i.id === itemId)
      if (!row) return undefined
      const patchKeys = (Object.keys(patch) as (keyof ListItemPatch)[]).filter(
        (k) => patch[k] !== undefined,
      )
      const prevFields = Object.fromEntries(
        patchKeys.map((k) => [k, row[k]]),
      ) as Partial<ListItemWithGear>
      qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
        curr?.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
      )
      return { itemId, prevFields }
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return
      qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
        curr?.map((i) => (i.id === ctx.itemId ? { ...i, ...ctx.prevFields } : i)),
      )
    },
    onSettled: () => {
      // `> 1` = true siblings still pending (the settling mutation counts
      // itself); the last one out invalidates once for the whole burst.
      if (qc.isMutating({ mutationKey: updateMutKey }) > 1) return
      void qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    },
  })

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => deleteListItem(listId, itemId),
    ...makeOptimisticDelete<ListItemWithGear, string>({
      qc,
      queryKey: queryKeys.listItems(listId),
      id: (itemId) => itemId,
    }),
  })

  // Quick Add creates a gear_item (so it also lands in the gear library) and
  // the matching list_item together in one atomic server call. NON-optimistic:
  // pure cache-invalidate on success (both the gear and this list's items),
  // with a meta.errorToast for the failure path. cost/purchaseDate are out of
  // scope for Quick Add and fixed at null by the server.
  const addNewItem = useMutation({
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

  return { addItem, updateItem, deleteItem, addNewItem }
}
