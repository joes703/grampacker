import {
  listItemResponseSchema,
  type ListItemResponse,
  type QuickAddListItemRequestInput,
  type ReorderListItemsRequest,
  type ReorderPackListItemsRequest,
  type UpdateListItemRequest,
} from '../../../shared/lists'
import { apiFetch, apiFetchVoid } from '../api'

// Membership row + its embedded gear row, exactly the old repo's
// ListItemWithGear shape (camelCased) so the list components and their
// cache invalidation port unchanged.
export type ListItemWithGear = ListItemResponse

// The per-list-item PATCH shape, under the name the old repo's hooks and
// components already use.
export type ListItemPatch = UpdateListItemRequest

export async function fetchListItems(
  listId: string,
): Promise<ListItemWithGear[]> {
  return apiFetch(`/lists/${listId}/items`, listItemResponseSchema.array())
}

// Adds EXISTING library gear to the list (the LibraryPanel path).
export async function addListItem(
  listId: string,
  gearItemId: string,
): Promise<ListItemWithGear> {
  return apiFetch(`/lists/${listId}/items`, listItemResponseSchema, {
    method: 'POST',
    body: { gearItemId },
  })
}

// Quick-Add: creates the gear item AND its membership row in one atomic
// server call (the old add_gear_item_with_list_item RPC). Callers must
// also invalidate the gearItems cache - the new gear is library gear.
export async function quickAddListItem(
  listId: string,
  input: QuickAddListItemRequestInput,
): Promise<ListItemWithGear> {
  return apiFetch(`/lists/${listId}/items/quick-add`, listItemResponseSchema, {
    method: 'POST',
    body: input,
  })
}

// PATCH semantics: absent = unchanged. Worn/consumable exclusivity is
// enforced server-side against the merged row; the old UI's handoff
// (both flags in one patch) is the supported shape.
export async function updateListItem(
  listId: string,
  itemId: string,
  patch: UpdateListItemRequest,
): Promise<ListItemWithGear> {
  return apiFetch(
    `/lists/${listId}/items/${itemId}`,
    listItemResponseSchema,
    { method: 'PATCH', body: patch },
  )
}

// Removes the membership row only; the gear stays in the library.
export async function deleteListItem(
  listId: string,
  itemId: string,
): Promise<void> {
  await apiFetchVoid(`/lists/${listId}/items/${itemId}`, { method: 'DELETE' })
}

export async function reorderListItems(
  listId: string,
  updates: ReorderListItemsRequest,
): Promise<void> {
  await apiFetchVoid(`/lists/${listId}/items/order`, {
    method: 'PUT',
    body: updates,
  })
}

// Pack view's reorder. Separate endpoint, separate payload key: this writes
// pack_sort_order, the rank within a packing location, and leaves the document
// order the List view and the public share link read completely alone.
export async function reorderPackListItems(
  listId: string,
  updates: ReorderPackListItemsRequest,
): Promise<void> {
  await apiFetchVoid(`/lists/${listId}/items/pack-order`, {
    method: 'PUT',
    body: updates,
  })
}

export async function resetPackedForList(listId: string): Promise<void> {
  await apiFetchVoid(`/lists/${listId}/items/reset-packed`, {
    method: 'POST',
  })
}

export async function resetReadyForList(listId: string): Promise<void> {
  await apiFetchVoid(`/lists/${listId}/items/reset-ready`, {
    method: 'POST',
  })
}
