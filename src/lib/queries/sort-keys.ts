// Supabase-free home for the pure dedup-key and sort_order helpers used by
// the CSV import paths. Keeping them here (importing nothing but types) lets
// the pure planner in import-plan.ts depend on them without transitively
// pulling in `supabase`, which would create an import cycle and break the
// planner's purity. The original modules (import-helpers.ts, categories.ts,
// gear.ts) re-export from here for back-compat so existing call sites are
// unchanged.

import type { Category, GearItem } from '../types'

// Composite dedup key: a CSV row matches an existing gear item when its
// category + lowercase name + weight all agree. Same shape used to seed the
// existing-gear map and to look up each row.
//
// Unicode normalization: NFC before lowercase so visually identical names
// that happen to be encoded differently (e.g. "café" with a precomposed
// `é` vs. "café" composed as `e` + combining acute) compare equal.
// Without this, a re-import from a tool that emits NFD created duplicate
// gear rows for the same item. NFC + toLowerCase (not toLocaleLowerCase)
// stays locale-independent so the key is identical in every runtime.
export function gearKey(categoryId: string | null, name: string, weight_grams: number): string {
  return `${categoryId ?? ''}:${name.trim().normalize('NFC').toLowerCase()}:${weight_grams}`
}

// Next sort_order slot for a newly-created category. Robust to gaps:
// deleteCategory does NOT compact remaining rows, so the existing
// sequence is sparse whenever a delete has happened, and naive
// length-based slot picking (the original convention everywhere a
// category was created) collides with an existing row. Reads order by
// (sort_order, name), so the collision either ties or rearranges
// silently.
//
// `offset` is for batched callers (CSV import): pass 0 for the first
// new category in a single client-side gesture, 1 for the next, etc.,
// so they walk off the end of the existing max without recomputing it
// against partially-inserted state.
export function nextCategorySortOrder(
  existing: Pick<Category, 'sort_order'>[],
  offset = 0,
): number {
  let max = -1
  for (const c of existing) if (c.sort_order > max) max = c.sort_order
  return max + 1 + offset
}

// Next sort_order slot for a newly-created gear item. Same rationale as
// nextCategorySortOrder: deleteGearItem (and bulkDeleteGearItems) do not
// compact, so the existing sequence is sparse after any delete, and
// length-based slot picking ties with an existing row. The (sort_order,
// name) read order then silently reshuffles the user's gear library.
// `offset` is for batched callers (CSV import): pass 0 for the first new
// row, 1 for the next, etc.
export function nextGearItemSortOrder(
  existing: Pick<GearItem, 'sort_order'>[],
  offset = 0,
): number {
  let max = -1
  for (const g of existing) if (g.sort_order > max) max = g.sort_order
  return max + 1 + offset
}
