import {
  gearItemResponseSchema,
  importGearResponseSchema,
  type CreateGearItemRequestInput,
  type GearItemResponse,
  type ImportGearRequestInput,
  type ImportGearResponse,
  type ReorderRequest,
  type UpdateGearItemRequest,
} from '../../../shared/gear'
import { apiFetch, apiFetchVoid } from '../api'

// The SPA-side gear type IS the shared DTO (see categories.ts for the
// camelCase rationale). cost is dollars; the cents live server-side only.
export type GearItem = GearItemResponse

export async function fetchGearItems(): Promise<GearItem[]> {
  return apiFetch('/gear-items', gearItemResponseSchema.array())
}

export async function createGearItem(
  input: CreateGearItemRequestInput,
): Promise<GearItem> {
  return apiFetch('/gear-items', gearItemResponseSchema, {
    method: 'POST',
    body: input,
  })
}

// PATCH semantics: absent = unchanged, null = clear (nullable fields).
export async function updateGearItem(
  id: string,
  patch: UpdateGearItemRequest,
): Promise<GearItem> {
  return apiFetch(`/gear-items/${id}`, gearItemResponseSchema, {
    method: 'PATCH',
    body: patch,
  })
}

export async function deleteGearItem(id: string): Promise<void> {
  await apiFetchVoid(`/gear-items/${id}`, { method: 'DELETE' })
}

// Bulk ops are all-or-nothing on the server: one non-owned id means zero
// writes (stricter than the old app's RLS silent-skip).
export async function bulkDeleteGearItems(ids: string[]): Promise<void> {
  await apiFetchVoid('/gear-items/bulk-delete', {
    method: 'POST',
    body: { ids },
  })
}

export async function bulkMoveToCategoryGearItems(
  ids: string[],
  categoryId: string | null,
): Promise<void> {
  await apiFetchVoid('/gear-items/bulk-move', {
    method: 'POST',
    body: { ids, categoryId },
  })
}

export async function reorderGearItems(entries: ReorderRequest): Promise<void> {
  await apiFetchVoid('/gear-items/order', { method: 'PUT', body: entries })
}

// Atomic CSV import: new categories + new gear land in one server-side
// transaction (the old app orphaned categories when the gear insert
// failed). The request is the client-built plan (see src/lib/csv/
// import-plan.ts); the server mints real ids for `new` category refs.
export async function importGearItems(
  request: ImportGearRequestInput,
): Promise<ImportGearResponse> {
  return apiFetch('/gear-items/import', importGearResponseSchema, {
    method: 'POST',
    body: request,
  })
}
