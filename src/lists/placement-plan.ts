import { assignSortOrderSlots } from '../lib/grouping'
import type { ListItemWithGear } from '../lib/types'

// The ordering half of click-to-place: reordering a row inside its bag without
// dragging (WCAG 2.5.7 wants a single-pointer path that is not a drag).
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
 * `eligibleItems` MUST be the exact array the section rendered - the one
 * `renderRows` was handed. It is deliberately not rebuilt from a location id:
 * the displayed cohort and the drag planner's cohort agree on settled data but
 * diverge while a location delete is still optimistic, when rows whose location
 * no longer resolves are displayed under Unassigned (packing-tree.ts) while a
 * raw `packingLocationId` scan still groups them separately. Passing the
 * rendered array through means the plan always describes what the user was
 * actually looking at.
 *
 * Ranks come from assignSortOrderSlots, which permutes the values the cohort
 * already holds. That keeps the list-wide multiset unchanged (so rows outside
 * this bag never renumber) and satisfies the optimistic reorder validator,
 * which requires exactly that permutation property.
 */
export function planPlacementWithinLocation(
  itemId: string,
  insertIndex: number,
  eligibleItems: readonly ListItemWithGear[],
): { id: string; sortOrder: number }[] | null {
  const sourceIndex = eligibleItems.findIndex((item) => item.id === itemId)
  if (sourceIndex === -1) return null

  const reduced = eligibleItems.filter((item) => item.id !== itemId)
  if (insertIndex < 0 || insertIndex > reduced.length) return null
  // The row is already there. Callers suppress these slots, so reaching this
  // is a bug rather than a user action - but returning null keeps a stray
  // click from issuing a write that changes nothing.
  if (insertIndex === sourceIndex) return null

  const moving = eligibleItems[sourceIndex]
  if (!moving) return null
  const next = [...reduced.slice(0, insertIndex), moving, ...reduced.slice(insertIndex)]
  return assignSortOrderSlots(next)
}

/**
 * The accessible name for a slot. A screen-reader user arrives at the button
 * with none of the surrounding context, so the label has to name the row being
 * moved, the destination, and the bag.
 */
export function placementSlotLabel(
  movingName: string,
  slot: number,
  eligibleItems: readonly ListItemWithGear[],
  bagName: string,
): string {
  const before = eligibleItems[slot]
  return before
    ? `Place ${movingName} before ${before.gearItem.name}`
    : `Place ${movingName} at the end of ${bagName}`
}
