import type { Category, GearItem, ListItemWithGear } from './types'

export type CategoryGroup<T> = { category: Category | null; items: T[] }
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

// Buckets items by group id and emits the groups in the order given, then a
// trailing null group for items with no group (or, with route-to-ungrouped,
// an unknown one). With `stability`, a group whose object and items are
// unchanged from the prior result reuses the prior entry, and an unchanged
// result returns the prior array itself, so memoized children skip work.
export function groupBy<G extends { id: string }, T>(
  items: T[],
  groups: G[],
  getGroupId: (item: T) => string | null,
  options: GroupOptions<Group<G, T>, T>,
): Group<G, T>[] {
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
    ? new Map(stability.prior.map((entry) => [entry.group?.id ?? null, entry] as const))
    : null
  const result: Group<G, T>[] = []

  function pushGroup(group: G | null, groupItems: T[]) {
    const prior = priorByKey?.get(group?.id ?? null)
    if (stability && prior && prior.group === group && stability.itemsEqual(prior.items, groupItems)) {
      result.push(prior)
      return
    }
    result.push({ group, items: groupItems })
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

// groupBy with the result field named `category`, for the category views.
export function groupByCategory<T>(
  items: T[],
  categories: Category[],
  getCategoryId: (item: T) => string | null,
  options: { keepEmpty: boolean; orphanPolicy: OrphanPolicy },
): CategoryGroup<T>[] {
  return groupBy(items, categories, getCategoryId, options).map(({ group, items: groupItems }) => ({
    category: group,
    items: groupItems,
  }))
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
    // Both orderings, or Pack goes stale. This equality drives group-reference
    // reuse across renders, so omitting the pack rank would let a pack reorder
    // reuse the memoized group it just changed - the write lands in the cache
    // and the section keeps rendering the old order until something unrelated
    // invalidates it.
    if (x.packSortOrder !== y.packSortOrder) return false
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

/**
 * Group list items by their gear item's category. Categories are emitted in
 * `Category.sortOrder` order; items with no resolvable category fall into a
 * trailing `category: null` group ("Uncategorized").
 *
 * Empty categories are filtered OUT — the list view shouldn't show category
 * sections that contain none of this list's items. (This is the deliberate
 * divergence from `groupGearItemsByCategory`, which retains them.)
 *
 * Implementation: single-pass bucket map keyed by categoryId (O(N+C)).
 * The old repo's prior implementation used N filter passes (O(N×C)).
 */
export function groupListItemsByCategory(
  items: ListItemWithGear[],
  categories: Category[],
): CategoryGroup<ListItemWithGear>[] {
  const sortedCats = categories.toSorted((a, b) => a.sortOrder - b.sortOrder)
  return groupByCategory(items, sortedCats, (item) => item.gearItem.categoryId, {
    keepEmpty: false,
    orphanPolicy: 'route-to-ungrouped',
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

// The pack-order twin of assignSortOrderSlots: redistributes the cohort's
// EXISTING pack ranks over its newly-ordered rows.
//
// Permuting rather than minting matters more here than it does for sortOrder.
// packSortOrder carries a unique index per cohort, so any value not already
// held by one of these rows risks colliding with a row this payload does not
// mention - which the server would reject rather than apply. The server's
// validation is index safety (no collision with an untouched same-table row)
// rather than a strict permutation, and a permutation always satisfies it.
//
// Callers pass only the VISIBLE rows. Worn rows are excluded from the packing
// tree and keep their ranks reserved: permuting `{0, 2}` over two visible rows
// while a worn row sits at 1 leaves the worn slot untouched and still renders
// the two visible rows in the new order.
export function assignPackRankSlots<
  T extends { id: string; packSortOrder: number },
>(reorderedItems: T[]): { id: string; packSortOrder: number }[] {
  const slots = reorderedItems.map((i) => i.packSortOrder).sort((a, b) => a - b)
  // Non-null assertion: `slots` and `reorderedItems` have identical length by
  // construction, so slots[idx] is always defined for every idx in the map.
  return reorderedItems.map((i, idx) => ({ id: i.id, packSortOrder: slots[idx]! }))
}
