import {
  listResponseSchema,
  sharedListResponseSchema,
  type CreateListFromSelectionRequest,
  type ImportListRequestInput,
  type ListResponse,
  type ReorderListsRequest,
  type SharedListResponse,
  type UpdateListRequest,
} from '../../../shared/lists'
import { ApiError, apiFetch, apiFetchVoid } from '../api'

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

// Swaps the list's share link for a new one. The old /r/:slug stops
// resolving; sharing stays however it was.
export async function rotateShareLink(id: string): Promise<List> {
  return apiFetch(`/lists/${id}/share-link`, listResponseSchema, {
    method: 'POST',
  })
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

// CSV import -> new list. The body is a fully-resolved import plan (see
// src/lib/csv/import-plan.ts planListImport); the server creates the
// list, new categories, new gear, and items in one atomic batch, so a
// rejected or failed import leaves no orphans behind.
export async function importListFromCsv(
  input: ImportListRequestInput,
): Promise<List> {
  return apiFetch('/lists/import', listResponseSchema, {
    method: 'POST',
    body: input,
  })
}

// Public share read (anon; the session cookie is simply irrelevant). The
// 404 is the legitimate "this slug isn't a shared list" signal - unknown
// slug and sharing-turned-off are the same response by design - and maps
// to null so SharePage renders its friendly "List not found" copy. Every
// OTHER error (network, 5xx) propagates so TanStack Query exposes the
// failure and the page distinguishes a real outage from a bad link
// (ported convention: the old fetchSharedList treated PGRST116 this way).
export async function fetchSharedList(
  slug: string,
): Promise<SharedListResponse | null> {
  try {
    // /v2 is a cache-busting rename, not a versioned API. Share responses
    // used to carry no Cache-Control, so a browser that loaded a list before
    // it was unshared could keep serving it from its own cache; adding
    // no-store cannot reach an entry already stored under the old policy, but
    // a new URL is a new cache key. The public /r/:slug link people actually
    // hold is unchanged - only this internal path moved. A tab on the old
    // bundle asks the removed path and renders "List not found" until it
    // navigates; stale tabs are explicitly not supported.
    return await apiFetch(`/shares/v2/${slug}`, sharedListResponseSchema)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}
