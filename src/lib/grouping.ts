import type { Category, GearItem, ListItemWithGear, PackingLocation } from './types'

export type CategoryGroup<T> = { category: Category | null; items: T[] }
export type LocationGroup<T> = { location: PackingLocation | null; items: T[] }
export type Group<G, T> = { group: G | null; items: T[] }

type OrphanPolicy = 'route-to-ungrouped' | 'drop'

type GroupOptions<R, T> = {
  keepEmpty: boolean
  orphanPolicy: OrphanPolicy
  stability?: {
    prior: R[]
    itemsEqual: (a: T[], b: T[]) => boolean
  }
}

function groupByCore<G extends { id: string }, T, R>(
  items: T[],
  groups: G[],
  getGroupId: (item: T) => string | null,
  options: GroupOptions<R, T>,
  getGroup: (result: R) => G | null,
  getItems: (result: R) => T[],
  makeGroup: (group: G | null, groupItems: T[]) => R,
): R[] {
  const { keepEmpty, orphanPolicy, stability } = options
  const buckets = new Map<string | null, T[]>()
  const groupMap = new Map(groups.map((group) => [group.id, group]))

  for (const item of items) {
    const raw = getGroupId(item)
    let key: string | null
    if (raw === null) {
      key = null
    } else if (groupMap.has(raw)) {
      key = raw
    } else if (orphanPolicy === 'route-to-ungrouped') {
      key = null
    } else {
      continue
    }

    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }

  const priorByKey = stability
    ? new Map(stability.prior.map((result) => [getGroup(result)?.id ?? null, result] as const))
    : null
  const result: R[] = []

  function pushGroup(group: G | null, groupItems: T[]) {
    const priorGroup = priorByKey?.get(group?.id ?? null)
    if (
      stability &&
      priorGroup &&
      getGroup(priorGroup) === group &&
      stability.itemsEqual(getItems(priorGroup), groupItems)
    ) {
      result.push(priorGroup)
      return
    }
    result.push(makeGroup(group, groupItems))
  }

  for (const group of groups) {
    const groupItems = buckets.get(group.id) ?? []
    if (groupItems.length === 0 && !keepEmpty) continue
    pushGroup(group, groupItems)
  }

  const ungrouped = buckets.get(null)
  if (ungrouped && ungrouped.length > 0) pushGroup(null, ungrouped)

  if (
    stability &&
    stability.prior.length === result.length &&
    result.every((entry, index) => entry === stability.prior[index])
  ) {
    return stability.prior
  }
  return result
}

export function groupBy<G extends { id: string }, T>(
  items: T[],
  groups: G[],
  getGroupId: (item: T) => string | null,
  options: GroupOptions<Group<G, T>, T>,
): Group<G, T>[] {
  return groupByCore(
    items,
    groups,
    getGroupId,
    options,
    (entry) => entry.group,
    (entry) => entry.items,
    (group, groupItems) => ({ group, items: groupItems }),
  )
}

type GroupByCategoryOptions<T> = {
  keepEmpty: boolean
  orphanPolicy: 'route-to-uncategorized' | 'drop'
  stability?: {
    prior: CategoryGroup<T>[]
    itemsEqual: (a: T[], b: T[]) => boolean
  }
}

export function groupByCategory<T>(
  items: T[],
  categories: Category[],
  getCategoryId: (item: T) => string | null,
  options: GroupByCategoryOptions<T>,
): CategoryGroup<T>[] {
  return groupByCore(
    items,
    categories,
    getCategoryId,
    {
      keepEmpty: options.keepEmpty,
      orphanPolicy:
        options.orphanPolicy === 'route-to-uncategorized'
          ? 'route-to-ungrouped'
          : 'drop',
      stability: options.stability,
    },
    (entry) => entry.category,
    (entry) => entry.items,
    (category, groupItems) => ({ category, items: groupItems }),
  )
}

// What "structurally identical" means for stability: same length AND for
// each index i, items[i] is referentially identical OR has identical render-
// affecting field values. Render-affecting fields for ListItemWithGear are
// the per-list trip fields (sortOrder, quantity, isPacked, isReady,
// isWorn, isConsumable, packingLocationId) plus the embedded gearItem's id + weightGrams
// + name + description + status. Description must be in the comparator
// because desktop ItemRow renders and edits it — excluding it would let
// memo skip the re-render after a description edit and leave stale text
// on screen. isReady and status are in here for the same reason:
// pack-mode rows render the Ready checkbox and ItemRow renders
// GearStatusBadge from gearItem.status, so a status-only fanout update
// must invalidate the items reference. Timestamps and other non-rendered
// gearItem fields stay out.
export function listItemsArrayEqual(a: ListItemWithGear[], b: ListItemWithGear[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x === y) continue
    if (x.id !== y.id) return false
    if (x.sortOrder !== y.sortOrder) return false
    if (x.quantity !== y.quantity) return false
    if (x.isPacked !== y.isPacked) return false
    if (x.isReady !== y.isReady) return false
    if (x.isWorn !== y.isWorn) return false
    if (x.isConsumable !== y.isConsumable) return false
    if (x.packingLocationId !== y.packingLocationId) return false
    if (x.gearItem.id !== y.gearItem.id) return false
    if (x.gearItem.weightGrams !== y.gearItem.weightGrams) return false
    if (x.gearItem.name !== y.gearItem.name) return false
    if (x.gearItem.description !== y.gearItem.description) return false
    if (x.gearItem.status !== y.gearItem.status) return false
  }
  return true
}

export function groupListItemsByLocation(
  items: ListItemWithGear[],
  locations: PackingLocation[],
  prior?: LocationGroup<ListItemWithGear>[],
): LocationGroup<ListItemWithGear>[] {
  const sortedLocations = locations.toSorted((a, b) => a.sortOrder - b.sortOrder)
  return groupByCore(
    items,
    sortedLocations,
    (item) => item.packingLocationId,
    {
      keepEmpty: true,
      orphanPolicy: 'route-to-ungrouped',
      stability: prior ? { prior, itemsEqual: listItemsArrayEqual } : undefined,
    },
    (entry) => entry.location,
    (entry) => entry.items,
    (location, groupItems) => ({ location, items: groupItems }),
  )
}

/**
 * Group list items by their gear item's category. Categories are emitted in
 * `Category.sortOrder` order; items with no resolvable category fall into a
 * trailing `category: null` group ("Uncategorized").
 *
 * Empty categories are filtered OUT — the list view shouldn't show category
 * sections that contain none of this list's items. (This is the deliberate
 * divergence from `groupGearItemsByCategory`, which retains them.)
 *
 * Stability: when `prior` is supplied, per-group references are reused for
 * categories whose items are structurally identical to the prior call's
 * output, AND the top-level `prior` array reference itself is returned when
 * EVERY group is reused. The top-level identity invariant is load-bearing
 * for `useGroupedListItems` — without it the hook's setState-during-render
 * loop guard would never short-circuit.
 *
 * Implementation: single-pass bucket map keyed by categoryId (O(N+C)).
 * The old repo's prior implementation used N filter passes (O(N×C)).
 */
export function groupListItemsByCategory(
  items: ListItemWithGear[],
  categories: Category[],
  prior?: CategoryGroup<ListItemWithGear>[],
): CategoryGroup<ListItemWithGear>[] {
  const sortedCats = categories.toSorted((a, b) => a.sortOrder - b.sortOrder)
  return groupByCategory(items, sortedCats, (item) => item.gearItem.categoryId, {
    keepEmpty: false,
    orphanPolicy: 'route-to-uncategorized',
    stability: prior ? { prior, itemsEqual: listItemsArrayEqual } : undefined,
  })
}

/**
 * Group gear-library items by their categoryId. Categories are emitted in
 * `Category.sortOrder` order (the input array's order — caller pre-sorts);
 * items with no categoryId fall into a trailing `category: null` group
 * only if any exist.
 *
 * Empty categories are RETAINED — the gear library renders a category
 * section even when it has no items so the user can drag items into it
 * and use the "+ Add item to this category" affordance. (This is the
 * deliberate divergence from `groupListItemsByCategory`.)
 */
export function groupGearItemsByCategory(
  items: GearItem[],
  categories: Category[],
): CategoryGroup<GearItem>[] {
  return groupByCategory(items, categories, (item) => item.categoryId, {
    keepEmpty: true,
    orphanPolicy: 'drop',
  })
}

// Drag-reorder helper: given a re-ordered subset of items, redistribute the
// existing sortOrder values among them so the new order persists without
// renumbering items that weren't part of the drag. Returns updates ready for
// `reorderListItems` / `reorderCategories`.
export function assignSortOrderSlots<T extends { id: string; sortOrder: number }>(
  reorderedItems: T[],
): { id: string; sortOrder: number }[] {
  const slots = reorderedItems.map((i) => i.sortOrder).sort((a, b) => a - b)
  // Non-null assertion: `slots` and `reorderedItems` have identical length by
  // construction, so slots[idx] is always defined for every idx in the map.
  return reorderedItems.map((i, idx) => ({ id: i.id, sortOrder: slots[idx]! }))
}
