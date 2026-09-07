// Supabase-free home for the pure sortOrder helpers used by
// the CSV import paths. Keeping them here (importing nothing but types) lets
// the pure planner in import-plan.ts depend on them without transitively
// pulling in `supabase`, which would create an import cycle and break the
// planner's purity. The original modules (import-helpers.ts, categories.ts,
// gear.ts) re-export from here for back-compat so existing call sites are
// unchanged.

import type { Category, GearItem, List, ListItemWithGear } from '../types'

// Next sortOrder slot for a newly-created category. Robust to gaps:
// deleteCategory does NOT compact remaining rows, so the existing
// sequence is sparse whenever a delete has happened, and naive
// length-based slot picking (the original convention everywhere a
// category was created) collides with an existing row. Reads order by
// (sortOrder, name), so the collision either ties or rearranges
// silently.
//
// `offset` is for batched callers (CSV import): pass 0 for the first
// new category in a single client-side gesture, 1 for the next, etc.,
// so they walk off the end of the existing max without recomputing it
// against partially-inserted state.
export function nextCategorySortOrder(
  existing: Pick<Category, 'sortOrder'>[],
  offset = 0,
): number {
  let max = -1
  for (const c of existing) if (c.sortOrder > max) max = c.sortOrder
  return max + 1 + offset
}

// Next sortOrder slot for a newly-created gear item. Same rationale as
// nextCategorySortOrder: deleteGearItem (and bulkDeleteGearItems) do not
// compact, so the existing sequence is sparse after any delete, and
// length-based slot picking ties with an existing row. The (sortOrder,
// name) read order then silently reshuffles the user's gear library.
// `offset` is for batched callers (CSV import): pass 0 for the first new
// row, 1 for the next, etc.
export function nextGearItemSortOrder(
  existing: Pick<GearItem, 'sortOrder'>[],
  offset = 0,
): number {
  let max = -1
  for (const g of existing) if (g.sortOrder > max) max = g.sortOrder
  return max + 1 + offset
}

// Next sortOrder slot for a newly-created list. Same sparse-order
// rationale as the helpers above: deleteList does not compact survivors,
// so length-based slot picking ties with an existing row whenever a
// delete has happened, and the (sortOrder, name) read order silently
// reshuffles the lists index. The SERVER assigns the persisted slot on
// create; this computes the same value against the cached rows so the
// optimistic placeholder lands where the server row will.
export function nextListSortOrder(
  existing: Pick<List, 'sortOrder'>[],
  offset = 0,
): number {
  let max = -1
  for (const l of existing) if (l.sortOrder > max) max = l.sortOrder
  return max + 1 + offset
}

// Next sortOrder slot for a newly-created list_item, scoped to its list.
// Pass the cached list-items array for the current list; the helper only
// reads sortOrder so a Pick is enough. Server-assigned on create, same
// placeholder rationale as nextListSortOrder.
export function nextListItemSortOrder(
  existing: Pick<ListItemWithGear, 'sortOrder'>[],
  offset = 0,
): number {
  let max = -1
  for (const li of existing) if (li.sortOrder > max) max = li.sortOrder
  return max + 1 + offset
}
