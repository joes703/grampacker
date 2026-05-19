import type { Category, GearItem, ListItemWithGear } from './types'

export type CategoryGroup<T> = { category: Category | null; items: T[] }

type GroupByCategoryOptions<T> = {
  keepEmpty: boolean
  orphanPolicy: 'route-to-uncategorized' | 'drop'
  stability?: {
    prior: CategoryGroup<T>[]
    itemsEqual: (a: T[], b: T[]) => boolean
  }
}

// What "structurally identical" means for stability: same length AND for
// each index i, items[i] is referentially identical OR has identical render-
// affecting field values. Render-affecting fields for ListItemWithGear are
// the per-list trip fields (sort_order, quantity, is_packed, is_ready,
// is_worn, is_consumable) plus the embedded gear_item's id + weight_grams
// + name + description. Description must be in the comparator because
// desktop ItemRow renders and edits it — excluding it would let memo skip
// the re-render after a description edit and leave stale text on screen.
// is_ready is in here for the same reason: pack-mode rows render its
// checkbox state, so omitting it would let an is_ready-only update slip
// past the structural-stability layer and reuse the prior items array,
// leaving the Ready checkbox visually stuck. Timestamps and other
// non-rendered gear_item fields stay out.
function listItemsArrayEqual(a: ListItemWithGear[], b: ListItemWithGear[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x === y) continue
    if (x.id !== y.id) return false
    if (x.sort_order !== y.sort_order) return false
    if (x.quantity !== y.quantity) return false
    if (x.is_packed !== y.is_packed) return false
    if (x.is_ready !== y.is_ready) return false
    if (x.is_worn !== y.is_worn) return false
    if (x.is_consumable !== y.is_consumable) return false
    if (x.gear_item.id !== y.gear_item.id) return false
    if (x.gear_item.weight_grams !== y.gear_item.weight_grams) return false
    if (x.gear_item.name !== y.gear_item.name) return false
    if (x.gear_item.description !== y.gear_item.description) return false
  }
  return true
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

/**
 * Group list items by their gear item's category. Categories are emitted in
 * `Category.sort_order` order; items with no resolvable category fall into a
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
 * Implementation: single-pass bucket map keyed by category_id (O(N+C)).
 * The prior implementation used N filter passes (O(N×C)).
 */
export function groupListItemsByCategory(
  items: ListItemWithGear[],
  categories: Category[],
  prior?: CategoryGroup<ListItemWithGear>[],
): CategoryGroup<ListItemWithGear>[] {
  const sortedCats = categories.toSorted((a, b) => a.sort_order - b.sort_order)
  return groupByCategory(items, sortedCats, (item) => item.gear_item.category_id, {
    keepEmpty: false,
    orphanPolicy: 'route-to-uncategorized',
    stability: prior ? { prior, itemsEqual: listItemsArrayEqual } : undefined,
  })
}

/**
 * Group gear-library items by their category_id. Categories are emitted in
 * `Category.sort_order` order (the input array's order — caller pre-sorts);
 * items with no category_id fall into a trailing `category: null` group
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
  return groupByCategory(items, categories, (item) => item.category_id, {
    keepEmpty: true,
    orphanPolicy: 'drop',
  })
}

// Drag-reorder helper: given a re-ordered subset of items, redistribute the
// existing sort_order values among them so the new order persists without
// renumbering items that weren't part of the drag. Returns updates ready for
// `reorderListItems` / `reorderCategories`.
export function assignSortOrderSlots<T extends { id: string; sort_order: number }>(
  reorderedItems: T[],
): { id: string; sort_order: number }[] {
  const slots = reorderedItems.map((i) => i.sort_order).sort((a, b) => a - b)
  // Non-null assertion: `slots` and `reorderedItems` have identical length by
  // construction, so slots[idx] is always defined for every idx in the map.
  return reorderedItems.map((i, idx) => ({ id: i.id, sort_order: slots[idx]! }))
}
