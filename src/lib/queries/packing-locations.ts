import {
  packingLocationResponseSchema,
  type PackingLocationResponse,
  type ReorderPackingLocationsRequest,
} from '../../../shared/lists'
import { apiFetch, apiFetchVoid } from '../api'

export type PackingLocation = PackingLocationResponse

export async function fetchPackingLocations(listId: string): Promise<PackingLocation[]> {
  return apiFetch(
    `/lists/${listId}/packing-locations`,
    packingLocationResponseSchema.array(),
  )
}

export async function createPackingLocation(
  listId: string,
  name: string,
): Promise<PackingLocation> {
  return apiFetch(`/lists/${listId}/packing-locations`, packingLocationResponseSchema, {
    method: 'POST',
    body: { name },
  })
}

export async function renamePackingLocation(
  listId: string,
  locationId: string,
  name: string,
): Promise<PackingLocation> {
  return apiFetch(
    `/lists/${listId}/packing-locations/${locationId}`,
    packingLocationResponseSchema,
    { method: 'PATCH', body: { name } },
  )
}

export async function deletePackingLocation(
  listId: string,
  locationId: string,
): Promise<void> {
  await apiFetchVoid(`/lists/${listId}/packing-locations/${locationId}`, {
    method: 'DELETE',
  })
}

export async function reorderPackingLocations(
  listId: string,
  updates: ReorderPackingLocationsRequest,
): Promise<void> {
  await apiFetchVoid(`/lists/${listId}/packing-locations/order`, {
    method: 'PUT',
    body: updates,
  })
}
