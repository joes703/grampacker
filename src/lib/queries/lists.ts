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

// Points this list at a food plan (food-planning-design.md 3): a LIVE
// REFERENCE, not a copy, and a plan backs at most ONE list. Both return the
// updated list, so the caller writes the response straight into ['lists'].
// The server rejects a plan the caller does not own with 400 invalid_plan,
// and a plan another list already holds with 409 (one plan per trip).
export async function attachFoodPlan(
  id: string,
  foodPlanId: string,
): Promise<List> {
  return apiFetch(`/lists/${id}/food-plan`, listResponseSchema, {
    method: 'PUT',
    body: { foodPlanId },
  })
}

export async function detachFoodPlan(id: string): Promise<List> {
  return apiFetch(`/lists/${id}/food-plan`, listResponseSchema, {
    method: 'DELETE',
  })
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
    return await apiFetch(`/shares/${slug}`, sharedListResponseSchema)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}
