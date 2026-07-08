import {
  categoryResponseSchema,
  type CategoryResponse,
  type ReorderRequest,
} from '../../../shared/gear'
import { apiFetch, apiFetchVoid } from '../api'

// The SPA-side category type IS the shared DTO - one source of truth, no
// mapping layer to drift. (The old repo's snake_case row types came from
// Postgres via Supabase; the port goes camelCase end-to-end.)
export type Category = CategoryResponse

export async function fetchCategories(): Promise<Category[]> {
  return apiFetch('/categories', categoryResponseSchema.array())
}

export async function createCategory(name: string): Promise<Category> {
  return apiFetch('/categories', categoryResponseSchema, {
    method: 'POST',
    body: { name },
  })
}

export async function renameCategory(
  id: string,
  name: string,
): Promise<Category> {
  return apiFetch(`/categories/${id}`, categoryResponseSchema, {
    method: 'PATCH',
    body: { name },
  })
}

// Also uncategorizes the category's gear server-side (same transaction);
// callers must invalidate the gear-items cache too.
export async function deleteCategory(id: string): Promise<void> {
  await apiFetchVoid(`/categories/${id}`, { method: 'DELETE' })
}

// All-or-nothing on the server: one non-owned id means zero writes.
export async function reorderCategories(
  entries: ReorderRequest,
): Promise<void> {
  await apiFetchVoid('/categories/order', { method: 'PUT', body: entries })
}
