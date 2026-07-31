import { useState } from 'react'
import { groupBy, listItemsArrayEqual, type Group } from './grouping'
import type { Category, ListItemWithGear, PackingLocation } from './types'

export type ListItemGrouping =
  | { kind: 'category'; groups: Category[] }
  | { kind: 'location'; groups: PackingLocation[] }

export type StableListItemGroup = Group<Category | PackingLocation, ListItemWithGear>

// Which of the row's two orderings this view reads.
//
// The hook does not sort item buckets itself - it preserves the order of the
// `items` array it is handed, which is the cache's canonical DOCUMENT order.
// That is right for List view and wrong for Pack, so Pack hands in a
// pack-ordered array instead.
//
// This matters most on the surface that looks like it should not need it:
// Pack with no packing locations falls back to CATEGORY grouping, so without
// this a drag there would write a pack rank and then visibly snap back on the
// next refetch, because the refetched array is still in document order.
export type ListItemOrder = 'document' | 'pack'

function orderItems(
  items: ListItemWithGear[],
  order: ListItemOrder,
): ListItemWithGear[] {
  if (order === 'document') return items
  // The id tiebreak is defensive: pack ranks are unique within a cohort
  // (enforced by a unique index server-side), so a tie means something is
  // already corrupt and deterministic beats arbitrary.
  return items.toSorted(
    (a, b) =>
      a.packSortOrder - b.packSortOrder ||
      a.sortOrder - b.sortOrder ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

function buildGroups(
  items: ListItemWithGear[],
  grouping: ListItemGrouping,
  order: ListItemOrder,
  prior?: StableListItemGroup[],
): StableListItemGroup[] {
  const groups: (Category | PackingLocation)[] = grouping.groups
    .toSorted((a, b) => a.sortOrder - b.sortOrder)
  return groupBy(
    orderItems(items, order),
    groups,
    grouping.kind === 'category'
      ? (item) => item.gearItem.categoryId
      : (item) => item.packingLocationId,
    {
      keepEmpty: grouping.kind === 'location',
      orphanPolicy: 'route-to-ungrouped',
      stability: prior
        ? {
            prior,
            itemsEqual: listItemsArrayEqual,
          }
        : undefined,
    },
  )
}

/**
 * Stable wrapper around groupListItemsByCategory that lets the function
 * reuse per-group references (and the top-level array reference) across
 * renders when nothing changed. The top-level identity invariant in
 * groupListItemsByCategory is load-bearing here — when no group changed,
 * `next === cached`, the setState call below is skipped, and we avoid the
 * setState-during-render → re-render → setState-during-render infinite
 * loop that would otherwise fire.
 *
 * Why setState-during-render and not useRef + render-time write: React 19's
 * react-hooks/refs rule rejects synchronous ref writes during render.
 * Storing information from previous renders via setState during render IS
 * explicitly allowed by React when guarded against loops — see
 * https://react.dev/reference/react/useState#storing-information-from-previous-renders
 */
export function useGroupedListItems(
  items: ListItemWithGear[],
  grouping: ListItemGrouping,
  order: ListItemOrder = 'document',
): StableListItemGroup[] {
  const [cached, setCached] = useState<StableListItemGroup[]>(() =>
    buildGroups(items, grouping, order),
  )
  const next = buildGroups(items, grouping, order, cached)
  if (next !== cached) {
    setCached(next)
  }
  return next
}
