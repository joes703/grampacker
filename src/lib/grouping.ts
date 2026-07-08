import type { Category, GearItem } from './types'

export type CategoryGroup<T> = { category: Category | null; items: T[] }

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
  const { keepEmpty, orphanPolicy, stability } = options

  const buckets = new Map<string | null, T[]>()
  const catMap = new Map(categories.map((c) => [c.id, c]))
  for (const item of items) {
    const raw = getCategoryId(item)
    let key: string | null
    if (raw === null) {
      key = null
    } else if (catMap.has(raw)) {
      key = raw
    } else if (orphanPolicy === 'route-to-uncategorized') {
      key = null
    } else {
      continue
    }

    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
    }
    bucket.push(item)
  }

  const priorByKey = stability
    ? new Map(stability.prior.map((group) => [group.category?.id ?? null, group] as const))
    : null
  const result: CategoryGroup<T>[] = []

  function pushGroup(category: Category | null, items: T[]) {
    if (stability && priorByKey) {
      const priorGroup = priorByKey.get(category?.id ?? null)
      if (
        priorGroup &&
        priorGroup.category === category &&
        stability.itemsEqual(priorGroup.items, items)
      ) {
        result.push(priorGroup)
        return
      }
    }
    result.push({ category, items })
  }

  for (const category of categories) {
    // Use [] as the canonical empty-bucket value so every category goes
    // through the same stability check, including keepEmpty:true groups.
    const groupItems = buckets.get(category.id) ?? []
    if (groupItems.length === 0 && !keepEmpty) continue
    pushGroup(category, groupItems)
  }

  const uncategorized = buckets.get(null)
  if (uncategorized && uncategorized.length > 0) pushGroup(null, uncategorized)

  if (
    stability &&
    stability.prior.length === result.length &&
    result.every((group, index) => group === stability.prior[index])
  ) {
    return stability.prior
  }

  return result
}

// TRANSPLANT NOTE (phase 3): the old repo also exported
// groupListItemsByCategory (list-view grouping with the stability/prior
// reference-reuse machinery and its listItemsArrayEqual comparator). That
// half returns with the lists slice; the `stability` option on
// groupByCategory stays because it is the extension point that grouping
// depends on.

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
