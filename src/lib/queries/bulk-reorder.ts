import { reorderCategories } from './categories'
import { reorderGearItems } from './gear'

// Single-round-trip sort_order rewrite, routed to the table's REST
// endpoint (PUT /api/{resource}/order). The server validates that EVERY
// id is an owned row and applies the batch as one transaction - one
// foreign id means zero writes (server/routes tests pin this).
//
// The old repo's version called the bulk_update_sort_order Postgres RPC;
// the TS-side union still mirrors "tables with a reorder endpoint" so
// misuse stays a compile error rather than a runtime 404. Grows with the
// lists slice (phase 3).
export type ReorderableTable = 'categories' | 'gear_items'

export async function bulkUpdateSortOrder<
  T extends { id: string; sortOrder: number },
>(table: ReorderableTable, updates: T[]): Promise<void> {
  if (updates.length === 0) return
  const entries = updates.map((u) => ({ id: u.id, sortOrder: u.sortOrder }))
  if (table === 'categories') return reorderCategories(entries)
  return reorderGearItems(entries)
}
