import type { GearItemResponse } from '../../shared/gear'
import type { GearItemRow } from '../repos/gear-items'

// The one gear row -> DTO mapper, used by the gear routes and by the list
// routes' embedded gear. Dollars <-> integer cents at the DTO edge; the
// epsilon guard in the schema guarantees the rounding is exact. A new gear
// column reaches the wire only by being added here.
export function toGearItemResponse(row: GearItemRow): GearItemResponse {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    weightGrams: row.weightGrams,
    cost: row.costCents === null ? null : row.costCents / 100,
    purchaseDate: row.purchaseDate,
    status: row.status,
    sortOrder: row.sortOrder,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }
}
