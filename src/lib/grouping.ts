import type { Category, GearItem, ListItemWithGear } from './types'

export type CategoryGroup<T> = { category: Category | null; items: T[] }

// What "structurally identical" means for stability: same length AND for
// each index i, items[i] is referentially identical OR has identical render-
// affecting field values. Render-affecting fields for ListItemWithGear are
// the per-list trip fields (sort_order, quantity, is_packed, is_worn,
// is_consumable) plus the embedded gear_item's id + weight_grams + name +
// description. Description must be in the comparator because desktop
// ItemRow renders and edits it — excluding it would let memo skip the
// re-render after a description edit and leave stale text on screen.
// Timestamps and other non-rendered gear_item fields stay out.
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
    if (x.is_worn !== y.is_worn) return false
    if (x.is_consumable !== y.is_consumable) return false
    if (x.gear_item.id !== y.gear_item.id) return false
    if (x.gear_item.weight_grams !== y.gear_item.weight_grams) return false
    if (x.gear_item.name !== y.gear_item.name) return false
    if (x.gear_item.description !== y.gear_item.description) return false
  }
  return true
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
  const buckets = new Map<string | null, ListItemWithGear[]>()
  const catMap = new Map(categories.map((c) => [c.id, c]))
  for (const item of items) {
    const raw = item.gear_item.category_id
    const key = raw !== null && catMap.has(raw) ? raw : null
    let arr = buckets.get(key)
    if (!arr) {
      arr = []
      buckets.set(key, arr)
    }
    arr.push(item)
  }

  const priorByKey = new Map<string | null, CategoryGroup<ListItemWithGear>>()
  if (prior) {
    for (const g of prior) {
      priorByKey.set(g.category?.id ?? null, g)
    }
  }

  const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order)
  const result: CategoryGroup<ListItemWithGear>[] = []
  for (const cat of sortedCats) {
    const groupItems = buckets.get(cat.id)
    if (!groupItems || groupItems.length === 0) continue
    const priorGroup = priorByKey.get(cat.id)
    if (priorGroup && priorGroup.category === cat && listItemsArrayEqual(priorGroup.items, groupItems)) {
      result.push(priorGroup)
    } else {
      result.push({ category: cat, items: groupItems })
    }
  }

  const uncategorized = buckets.get(null)
  if (uncategorized && uncategorized.length > 0) {
    const priorGroup = priorByKey.get(null)
    if (priorGroup && priorGroup.category === null && listItemsArrayEqual(priorGroup.items, uncategorized)) {
      result.push(priorGroup)
    } else {
      result.push({ category: null, items: uncategorized })
    }
  }

  // Top-level identity invariant: when every group is reused, return the
  // prior top-level array itself (not a structurally-equal copy). The hook
  // depends on `next === prior` to skip its setState call and avoid an
  // infinite render loop.
  if (prior && prior.length === result.length) {
    let allSame = true
    for (let i = 0; i < result.length; i++) {
      if (result[i] !== prior[i]) {
        allSame = false
        break
      }
    }
    if (allSame) return prior
  }

  return result
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
  const groups: CategoryGroup<GearItem>[] = categories.map((cat) => ({
    category: cat as Category | null,
    items: items.filter((i) => i.category_id === cat.id),
  }))
  const uncategorized = items.filter((i) => i.category_id === null)
  if (uncategorized.length > 0) groups.push({ category: null, items: uncategorized })
  return groups
}

// Drag-reorder helper: given a re-ordered subset of items, redistribute the
// existing sort_order values among them so the new order persists without
// renumbering items that weren't part of the drag. Returns updates ready for
// `reorderListItems` / `reorderCategories`.
export function assignSortOrderSlots<T extends { id: string; sort_order: number }>(
  reorderedItems: T[],
): { id: string; sort_order: number }[] {
  const slots = reorderedItems.map((i) => i.sort_order).slice().sort((a, b) => a - b)
  // Non-null assertion: `slots` and `reorderedItems` have identical length by
  // construction, so slots[idx] is always defined for every idx in the map.
  return reorderedItems.map((i, idx) => ({ id: i.id, sort_order: slots[idx]! }))
}
