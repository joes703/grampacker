import { useState } from 'react'
import { groupBy, listItemsArrayEqual, type Group } from './grouping'
import type { Category, ListItemWithGear, PackingLocation } from './types'

export type ListItemGrouping =
  | { kind: 'category'; groups: Category[] }
  | { kind: 'location'; groups: PackingLocation[] }

export type StableListItemGroup = Group<Category | PackingLocation, ListItemWithGear>

function buildGroups(
  items: ListItemWithGear[],
  grouping: ListItemGrouping,
  prior?: StableListItemGroup[],
): StableListItemGroup[] {
  const groups: (Category | PackingLocation)[] = grouping.groups
    .toSorted((a, b) => a.sortOrder - b.sortOrder)
  return groupBy(
    items,
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
): StableListItemGroup[] {
  const [cached, setCached] = useState<StableListItemGroup[]>(() =>
    buildGroups(items, grouping),
  )
  const next = buildGroups(items, grouping, cached)
  if (next !== cached) {
    setCached(next)
  }
  return next
}
