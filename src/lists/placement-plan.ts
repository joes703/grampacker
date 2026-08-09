import {
  assignUnionPackRankSlots,
  packRowId,
  packRowName,
  type PackRow,
  type UnionRankUpdates,
} from './pack-rows'

// The ordering half of click-to-place: reordering a row inside its bag without
// dragging (WCAG 2.5.7 wants a single-pointer path that is not a drag). Since
// 0022 the rows are the UNION of gear and food - a placement can put tortillas
// between the stove and the pot - so the plan operates on PackRow[] and
// returns both payload halves.
//
// Two coordinate systems meet here and confusing them is the whole risk.
//
//   VISUAL SLOT   an insertion point drawn between the rendered rows. n rows
//                 means n + 1 slots, including one above the first row and one
//                 below the last.
//   INSERT INDEX  a splice index into the array with the moving row ALREADY
//                 REMOVED.
//
// Removing the row first is what makes the second coordinate direction-free.
// Defining insertion over the original array instead needs a correction that
// applies only when the row moves down, which is exactly the shape that ships
// as "sometimes it lands one row off".

/** Visual slot -> insert index, given where the moving row currently sits. */
export function visualSlotToInsertIndex(slot: number, sourceIndex: number): number {
  return slot <= sourceIndex ? slot : slot - 1
}

/**
 * True for the two slots that touch the moving row - directly above it and
 * directly below it. Both mean "leave it where it is", so both are suppressed
 * rather than rendered as buttons that do nothing.
 *
 * They resolve to `insertIndex === sourceIndex`, which is also the planner's
 * no-op case, so the UI and the planner agree by construction instead of by
 * coincidence.
 */
export function isNoOpSlot(slot: number, sourceIndex: number): boolean {
  return visualSlotToInsertIndex(slot, sourceIndex) === sourceIndex
}

/**
 * Plan a placement.
 *
 * `eligibleRows` MUST be the exact array the section rendered - the one
 * `renderRows` was handed. It is deliberately not rebuilt from a location id:
 * the displayed cohort and the drag planner's cohort agree on settled data but
 * diverge while a location delete is still optimistic, when rows whose location
 * no longer resolves are displayed under Unassigned (packing-tree.ts) while a
 * raw `packingLocationId` scan still groups them separately. Passing the
 * rendered array through means the plan always describes what the user was
 * actually looking at.
 *
 * Ranks come from assignUnionPackRankSlots, which permutes the values the
 * union cohort already holds. That keeps the list-wide multiset unchanged (so rows outside
 * this bag never renumber) and satisfies the optimistic reorder validator,
 * which requires exactly that permutation property.
 */
export function planPlacementWithinLocation(
  rowId: string,
  insertIndex: number,
  eligibleRows: readonly PackRow[],
  /** Ranks of cohort rows NOT rendered here (worn gear, filtered rows,
   *  container headers) - the densify path must not mint one of them.
   *  Supplied by the page, which holds the caches (round-5 finding 2). */
  avoidRanks: ReadonlySet<number> = new Set(),
): UnionRankUpdates | null {
  const sourceIndex = eligibleRows.findIndex((row) => packRowId(row) === rowId)
  if (sourceIndex === -1) return null

  const reduced = eligibleRows.filter((row) => packRowId(row) !== rowId)
  if (insertIndex < 0 || insertIndex > reduced.length) return null
  // The row is already there. Callers suppress these slots, so reaching this
  // is a bug rather than a user action - but returning null keeps a stray
  // click from issuing a write that changes nothing.
  if (insertIndex === sourceIndex) return null

  const moving = eligibleRows[sourceIndex]
  if (!moving) return null
  const next = [...reduced.slice(0, insertIndex), moving, ...reduced.slice(insertIndex)]
  return assignUnionPackRankSlots(next, avoidRanks)
}

/**
 * The accessible name for a slot. A screen-reader user arrives at the button
 * with none of the surrounding context, so the label has to name the row being
 * moved, the destination, and the bag.
 */
export function placementSlotLabel(
  movingName: string,
  slot: number,
  eligibleRows: readonly PackRow[],
  bagName: string,
): string {
  const before = eligibleRows[slot]
  return before
    ? `Place ${movingName} before ${packRowName(before)}`
    : `Place ${movingName} at the end of ${bagName}`
}
