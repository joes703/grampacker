import { arrayMove } from '@dnd-kit/sortable'
import { parseDnDId } from '../lib/dnd-ids'
import { assignPackRankSlots, assignSortOrderSlots } from '../lib/grouping'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import type { ListDetailMode } from './list-detail-mode'
import type { UnionRankUpdates } from './pack-rows'
import { derivePackReorderExclusions } from './packing-tree'
import { isOrdinarySectionRow, passesPackFilters } from './section-rows'

// Planning for a drag that ends over an `item:` row - the List view's
// document-order reorder and the Pack view's category-fallback reorder. Pure:
// takes the rows, the view and what is hidden, returns the payload to write
// (tagged by which ordering it targets) or null. The Pack view's location
// tree has its own planner in packing-dnd.ts; this is its sibling, and it
// lives outside the page for the same reason - the page decides WHEN to
// plan, these functions decide WHAT the plan is, and only the latter is
// worth testing in isolation.

// Rows the pack-mode filters have hidden, by the shared predicate in
// section-rows.ts - the one CategoryGroup renders with, so what the planner
// permutes over is exactly what the user sees.
export function deriveFilteredItemIds(
  items: ListItemWithGear[],
  filters: {
    showUnpackedOnly: boolean
    showUnreadyOnly: boolean
  },
): Set<string> {
  const hidden = new Set<string>()
  if (!filters.showUnpackedOnly && !filters.showUnreadyOnly) return hidden
  for (const item of items) {
    if (!passesPackFilters(item, filters)) hidden.add(item.id)
  }
  return hidden
}

export function planListItemReorder({
  activeId,
  overId,
  items,
  groupingKind,
  mode,
  locations,
  hiddenItemIds,
}: {
  activeId: string
  overId: string | undefined
  items: ListItemWithGear[]
  groupingKind: 'category' | 'location'
  /** Which VIEW the drag happened in. Decides which ordering is written -
   *  see the note in the category branch for why grouping.kind cannot. */
  mode: ListDetailMode
  locations: PackingLocation[]
  // Rows currently filtered out of the rendered list (see
  // deriveFilteredItemIds). Empty set = nothing hidden.
  hiddenItemIds: ReadonlySet<string>
}):
  | { kind: 'pack'; updates: UnionRankUpdates }
  | { kind: 'list'; updates: { id: string; sortOrder: number }[] }
  | null {
  if (groupingKind === 'location') {
    const excludedItemIds = derivePackReorderExclusions(items, locations)
    for (const itemId of hiddenItemIds) excludedItemIds.add(itemId)
    // `item:`-kind ids in location grouping: a gear-only cohort reorder
    // (packing rows carry `packing-item:` ids and never reach this branch).
    // A gear-only permutation is still a valid UNION permutation - a subset's
    // ranks are a subset of the union multiset - so the food half is empty.
    if (overId === undefined || activeId === overId) return null
    const active = parseDnDId(activeId)
    const over = parseDnDId(overId)
    if (active?.kind !== 'item' || over?.kind !== 'item') return null
    const activeItem = items.find((i) => i.id === active.id)
    const overItem = items.find((i) => i.id === over.id)
    if (!activeItem || !overItem) return null
    if (excludedItemIds.has(activeItem.id) || excludedItemIds.has(overItem.id)) return null
    if (activeItem.packingLocationId !== overItem.packingLocationId) return null
    const locationItems = items
      .filter((i) =>
        i.packingLocationId === activeItem.packingLocationId &&
        !excludedItemIds.has(i.id),
      )
      .toSorted((a, b) => a.packSortOrder - b.packSortOrder)
    const oldIndex = locationItems.findIndex((i) => i.id === active.id)
    const newIndex = locationItems.findIndex((i) => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null
    // Location grouping is Pack view, so this writes the PACK rank. Tagging
    // the result rather than returning a bare array is what keeps the caller
    // from posting a pack permutation to the document-order endpoint - the two
    // payloads are structurally similar enough that an untagged union would be
    // an easy mistake to make and a hard one to see.
    return {
      kind: 'pack' as const,
      updates: {
        items: assignPackRankSlots(arrayMove(locationItems, oldIndex, newIndex)),
        foodItems: [],
      },
    }
  }

  const active = parseDnDId(activeId)
  const over = overId === undefined ? null : parseDnDId(overId)
  if (active?.kind !== 'item' || over?.kind !== 'item') return null

  const activeItem = items.find((item) => item.id === active.id)
  const overItem = items.find((item) => item.id === over.id)
  if (!activeItem || !overItem) return null
  if (hiddenItemIds.has(activeItem.id) || hiddenItemIds.has(overItem.id)) return null
  const categoryId = activeItem.gearItem.categoryId
  if (overItem.gearItem.categoryId !== categoryId) return null

  const categoryItems = items
    .filter((item) =>
      item.gearItem.categoryId === categoryId &&
      !hiddenItemIds.has(item.id) &&
      // Worn rows are extracted into the trailing Worn section in PACK mode
      // only, so there they are not part of the sequence the user is
      // rearranging and keep their ranks untouched; in List view they render
      // inside their category and reorder like any row. The location branch
      // already excludes them in pack (derivePackReorderExclusions). The
      // mode-scoped rule itself lives in section-rows.ts, shared with
      // CategoryGroup, because this branch and the renderer once disagreed
      // (audit F1): a List drag permuted over an invisible worn row and
      // rewrote its document rank.
      isOrdinarySectionRow(item, mode === 'pack'),
    )
    // Sorted by whichever order the user is actually looking at. The cache is
    // canonically in document order, so the pack fallback has to re-sort or it
    // would compute the move against a sequence not on screen.
    .toSorted((a, b) =>
      mode === 'pack'
        ? a.packSortOrder - b.packSortOrder
        : a.sortOrder - b.sortOrder,
    )
  const oldIndex = categoryItems.findIndex((item) => item.id === active.id)
  const newIndex = categoryItems.findIndex((item) => item.id === over.id)
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null
  const moved = arrayMove(categoryItems, oldIndex, newIndex)
  // MODE decides, not grouping.kind. Pack falls back to category grouping
  // until a list has its first packing location - which is every list on its
  // first visit - and a drag there is still a Pack action. Keying this on
  // grouping.kind would leave the original bug alive on exactly that surface,
  // and then creating a first location would reveal a stale pack order nobody
  // had arranged.
  //
  // Permuting a category-sized SUBSET of the Unassigned cohort is still a
  // valid cohort permutation: a subset's ranks are a subset of the multiset,
  // so redistributing them among themselves leaves the cohort intact.
  return mode === 'pack'
    ? {
        kind: 'pack' as const,
        updates: { items: assignPackRankSlots(moved), foodItems: [] },
      }
    : { kind: 'list' as const, updates: assignSortOrderSlots(moved) }
}
