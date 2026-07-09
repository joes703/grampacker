import {
  listResponseSchema,
  type CreateListFromSelectionRequest,
  type ListResponse,
  type ReorderListsRequest,
  type UpdateListRequest,
} from '../../../shared/lists'
import { apiFetch, apiFetchVoid } from '../api'

// The SPA-side list type IS the shared DTO (see categories.ts for the
// camelCase rationale). slug is server-minted; the client never invents
// one (the old repo's generateSlug/withSlugRetry died with the port).
export type List = ListResponse

export async function fetchLists(): Promise<List[]> {
  return apiFetch('/lists', listResponseSchema.array())
}

export async function createList(name: string): Promise<List> {
  return apiFetch('/lists', listResponseSchema, {
    method: 'POST',
    body: { name },
  })
}

// PATCH semantics: absent = unchanged, null = clear (nullable fields).
// isShared is not patchable until the share slice ships its routes.
export async function updateList(
  id: string,
  patch: UpdateListRequest,
): Promise<List> {
  return apiFetch(`/lists/${id}`, listResponseSchema, {
    method: 'PATCH',
    body: patch,
  })
}

export async function deleteList(id: string): Promise<void> {
  await apiFetchVoid(`/lists/${id}`, { method: 'DELETE' })
}

export async function reorderLists(
  updates: ReorderListsRequest,
): Promise<void> {
  await apiFetchVoid('/lists/order', { method: 'PUT', body: updates })
}

// Deep copy: server resets isShared/isDraft and mints a fresh slug.
export async function duplicateList(id: string): Promise<List> {
  return apiFetch(`/lists/${id}/duplicate`, listResponseSchema, {
    method: 'POST',
  })
}

// Gear-page multi-select -> new list. All-or-nothing server-side.
export async function createListFromSelection(
  input: CreateListFromSelectionRequest,
): Promise<List> {
  return apiFetch('/lists/from-selection', listResponseSchema, {
    method: 'POST',
    body: input,
  })
}
