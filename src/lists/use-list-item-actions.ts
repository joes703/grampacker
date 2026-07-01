import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  addGearItemToList,
  addGearItemWithListItem,
  updateListItem,
  deleteListItem,
  nextGearItemSortOrder,
  nextListItemSortOrder,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticDelete,
  type ListItemPatch,
} from '../lib/queries'
import { randomTempId } from '../lib/random-temp-id'
import type { GearItem, ListItemWithGear } from '../lib/types'
import { type AddItemData } from './use-quick-add-form'

// List-item write actions for ListDetailPage, lifted out of the page as the
// second ListDetailPage extraction slice (plan 2026-07-01-list-detail-f3),
// following the GearLibraryPage F3 precedent. These are the four ways the user
// changes THIS list's contents:
//   addItem     - add an EXISTING gear item to the list (LibraryPanel)
//   addNewItem  - Quick Add: create a new gear_item + list_item atomically (RPC)
//   updateItem  - patch per-list-item fields (quantity/worn/consumable/packed/ready)
//   deleteItem  - remove an item from the list
//
// All four return RAW useMutation objects so the page's memoized handler layer
// (sharedGroupProps, onLibraryAdd/Remove, onAddNewItem) can keep reading the
// referentially-stable `.mutate` through the live binding with []-deps - the
// mutation wrapper is fresh each render but `.mutate` is stable. Do NOT wrap
// these in callbacks here; that would defeat the memo boundary.
//
// `updateItem` keeps the sibling-in-flight invalidation gate: two parallel
// updates (e.g. tapping Packed then Ready quickly) each carry their own PATCH;
// letting an early settle invalidate would race a sibling write and overwrite
// its optimistic value with stale server data. In TanStack Query v5, onSettled
// runs before the settling mutation leaves the pending set, so this guard also
// skips the settling mutation itself. These small field patches rely on the
// optimistic cache update instead of a post-settle refetch.
//
// The page keeps: the addingNewItemRef double-fire guard (a UI/event concern),
// dialog orchestration, DnD/reorder, gear/category/notes/ready-checks mutations,
// and all UI state. `listItems`/`gearItems` are read for the next sort slots and
// the add optimistic placeholder, mirroring the prior inline closures.
export function useListItemActions(
  listId: string,
  userId: string,
  { listItems, gearItems }: { listItems: ListItemWithGear[]; gearItems: GearItem[] },
) {
  const qc = useQueryClient()

  const addItem = useMutation({
    mutationFn: (item: GearItem) =>
      addGearItemToList(listId, userId, item.id, nextListItemSortOrder(listItems)),
    ...makeOptimisticInsert<ListItemWithGear, GearItem>({
      qc,
      queryKey: queryKeys.listItems(listId),
      optimistic: (item) => {
        const now = new Date().toISOString()
        return {
          // Temp id replaced by the server row on settled refetch. The
          // randomTempId() suffix avoids any collision with real ids.
          id: `temp-${randomTempId()}`,
          list_id: listId,
          user_id: userId,
          gear_item_id: item.id,
          gear_item: {
            id: item.id,
            name: item.name,
            description: item.description,
            weight_grams: item.weight_grams,
            category_id: item.category_id,
            status: item.status,
          },
          quantity: 1,
          is_worn: false,
          is_consumable: false,
          is_packed: false,
          is_ready: false,
          sort_order: nextListItemSortOrder(listItems),
          created_at: now,
          updated_at: now,
        }
      },
    }),
  })

  // mutationKey is used by the onSettled override below to avoid refetching
  // while updateItem mutations are settling. Two parallel updateItem calls
  // (e.g. tapping Packed then Ready in quick succession) each carry their own
  // PATCH; an early invalidate can race a sibling write and overwrite its
  // optimistic value with stale server data. In TanStack Query v5, onSettled
  // runs before the settling mutation leaves the pending set, so this guard
  // also skips the settling mutation itself. Net effect: these small field
  // patches rely on the optimistic cache update instead of a post-settle
  // refetch, which is the behavior covered by the hook test.
  const updateMutKey = ['update-list-item', listId] as const
  const updateMutOptimistic = makeOptimisticUpdate<
    ListItemWithGear,
    { itemId: string; patch: ListItemPatch }
  >({
    qc,
    queryKey: queryKeys.listItems(listId),
    id: ({ itemId }) => itemId,
    apply: (item, { patch }) => ({ ...item, ...patch }),
  })
  const updateItem = useMutation({
    mutationKey: updateMutKey,
    mutationFn: ({ itemId, patch }: { itemId: string; patch: ListItemPatch }) =>
      updateListItem(itemId, patch),
    ...updateMutOptimistic,
    onSettled: () => {
      // onSettled runs while this mutation is still counted as pending, so this
      // guard skips both sibling-in-flight refetches and the settling mutation's
      // own refetch.
      if (qc.isMutating({ mutationKey: updateMutKey }) > 0) return
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    },
  })

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => deleteListItem(itemId),
    ...makeOptimisticDelete<ListItemWithGear, string>({
      qc,
      queryKey: queryKeys.listItems(listId),
      id: (itemId) => itemId,
    }),
  })

  // Quick Add creates a gear_item (so it also lands in the gear library) and the
  // matching list_item together via one atomic RPC. NON-optimistic: pure
  // cache-invalidate on success (both the gear and this list's items), with a
  // meta.errorToast for the failure path. cost/purchase_date are out of scope
  // for Quick Add and fixed at null by the RPC.
  const addNewItem = useMutation({
    mutationFn: ({ categoryId, data }: { categoryId: string | null; data: AddItemData }) =>
      addGearItemWithListItem({
        userId,
        name: data.name,
        description: data.description,
        weightGrams: data.weight_grams,
        categoryId,
        gearSortOrder: nextGearItemSortOrder(gearItems),
        listId,
        listItemSortOrder: nextListItemSortOrder(listItems),
        quantity: data.quantity,
        isWorn: data.is_worn,
        isConsumable: data.is_consumable,
      }),
    meta: { errorToast: "Couldn't add that item. Please try again." },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    },
  })

  return { addItem, updateItem, deleteItem, addNewItem }
}
