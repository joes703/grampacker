import type { FoodItemResponse } from '../../shared/food'
import type { ListItemWithGear } from '../lib/types'

// The union row model for Pack mode. Since 0022 a bag's contents are the
// UNION of its gear rows (list_items) and its food rows (list_food_items),
// merged into one display order. This module owns that merge and the
// rank-slot arithmetic over it; the server's `unionOrder` / union permutation
// in server/repos/pack-reorder.ts is the authority, and these MIRROR it so
// the optimistic render lands where the refetch will confirm.

export type PackRow =
  | { kind: 'gear'; gear: ListItemWithGear }
  | { kind: 'food'; food: FoodItemResponse }

export function packRowId(row: PackRow): string {
  return row.kind === 'gear' ? row.gear.id : row.food.id
}

export function packRowRank(row: PackRow): number {
  return row.kind === 'gear' ? row.gear.packSortOrder : row.food.packSortOrder
}

export function packRowLocationId(row: PackRow): string | null {
  return row.kind === 'gear'
    ? row.gear.packingLocationId
    : row.food.packingLocationId
}

export function packRowIsPacked(row: PackRow): boolean {
  return row.kind === 'gear' ? row.gear.isPacked : row.food.isPacked
}

export function packRowName(row: PackRow): string {
  return row.kind === 'gear' ? row.gear.gearItem.name : row.food.name
}

// Display order within a cohort: rank first, gear before food on a
// cross-table tie (per-table unique indexes cannot rule ties out across
// tables), id as the total-order backstop. Must match the server's
// `unionOrder` comparator.
export function comparePackRows(a: PackRow, b: PackRow): number {
  return (
    packRowRank(a) - packRowRank(b) ||
    (a.kind === b.kind ? 0 : a.kind === 'gear' ? -1 : 1) ||
    (packRowId(a) < packRowId(b) ? -1 : packRowId(a) > packRowId(b) ? 1 : 0)
  )
}

export function unionPackRows(
  gear: ListItemWithGear[],
  food: FoodItemResponse[],
): PackRow[] {
  return [
    ...gear.map((item): PackRow => ({ kind: 'gear', gear: item })),
    ...food.map((item): PackRow => ({ kind: 'food', food: item })),
  ].sort(comparePackRows)
}

export type UnionRankUpdates = {
  items: { id: string; packSortOrder: number }[]
  foodItems: { id: string; packSortOrder: number }[]
}

// The union twin of assignPackRankSlots (src/lib/grouping.ts): redistribute
// the cohort's EXISTING ranks - both tables' together - over the newly
// ordered rows, split back into per-table payload halves. Permuting keeps
// untouched rows' slots untouched, which is what the server's index-safety
// rule demands.
//
// EXCEPT when the rows hold a duplicate rank (a cross-table tie, left by a
// degraded old-worker interval or 0023's dense repair fallback): permuting
// would preserve the tie forever and some assignments would put both tied
// rows in one table, which the unique index rejects. So a tied cohort gets
// DENSE slots instead - the smallest nonnegative integers that avoid
// `avoidRanks` (the ranks of cohort rows NOT in this array: worn gear and
// filtered rows keep their reserved slots). The server accepts either shape;
// this is what makes "the next reorder dissolves the tie" true.
export function assignUnionPackRankSlots(
  reorderedRows: PackRow[],
  avoidRanks: ReadonlySet<number> = new Set(),
): UnionRankUpdates {
  const existing = reorderedRows.map(packRowRank).sort((a, b) => a - b)
  // A tie needing the dense path is EITHER a duplicate among these rows OR a
  // collision between one of their ranks and a reserved rank (a hidden or
  // worn row can be the other half of a cross-table tie - round-5 finding 1:
  // permuting would land a visible row on the hidden row's slot).
  const hasTie =
    existing.some((rank, i) => i > 0 && rank === existing[i - 1]) ||
    existing.some((rank) => avoidRanks.has(rank))
  let slots: number[]
  if (hasTie) {
    slots = []
    for (let candidate = 0; slots.length < reorderedRows.length; candidate++) {
      if (!avoidRanks.has(candidate)) slots.push(candidate)
    }
  } else {
    slots = existing
  }
  const updates: UnionRankUpdates = { items: [], foodItems: [] }
  reorderedRows.forEach((row, idx) => {
    // Non-null assertion: `slots` and `reorderedRows` have identical length
    // by construction, so slots[idx] is always defined.
    const entry = { id: packRowId(row), packSortOrder: slots[idx]! }
    if (row.kind === 'gear') updates.items.push(entry)
    else updates.foodItems.push(entry)
  })
  return updates
}

// The rank an ARRIVING row takes in a destination cohort: one past the
// cohort's UNION maximum. Mirrors the server's `nextUnionPackRank`
// (server/repos/pack-reorder.ts), the authority; the client computes it only
// so the optimistic row appears where the refetch will confirm it. Worn gear
// rows count - they keep their slot reserved.
export function nextUnionPackRankFor(
  gear: readonly ListItemWithGear[],
  food: readonly FoodItemResponse[],
  locationId: string | null,
): number {
  let max = -1
  for (const item of gear) {
    if (item.packingLocationId === locationId) {
      max = Math.max(max, item.packSortOrder)
    }
  }
  for (const item of food) {
    if (item.packingLocationId === locationId) {
      max = Math.max(max, item.packSortOrder)
    }
  }
  return max + 1
}
