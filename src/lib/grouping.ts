import type { Category, GearItem, ListItemWithGear } from './types'

export type CategoryGroup<T> = { category: Category | null; items: T[] }

// Group list items by their gear item's category. Categories are emitted in
// `Category.sort_order` order; items with no resolvable category fall into a
// trailing `category: null` group ("Uncategorised"). Categories with no
// matching items are omitted.
export function groupListItemsByCategory(
  items: ListItemWithGear[],
  categories: Category[],
): CategoryGroup<ListItemWithGear>[] {
  const catMap = new Map(categories.map((c) => [c.id, c]))
  const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order)

  const groups: CategoryGroup<ListItemWithGear>[] = sortedCats
    .map((cat) => ({
      category: cat as Category | null,
      items: items.filter((i) => i.gear_item.category_id === cat.id),
    }))
    .filter((g) => g.items.length > 0)

  const uncategorised = items.filter(
    (i) => i.gear_item.category_id === null || !catMap.has(i.gear_item.category_id),
  )
  if (uncategorised.length > 0) groups.push({ category: null, items: uncategorised })

  return groups
}

// Group gear-library items by their category_id. Categories are emitted in
// `Category.sort_order` order (the input array's order — caller pre-sorts);
// items with no category_id fall into a trailing `category: null` group only
// if any exist.
export function groupGearItemsByCategory(
  items: GearItem[],
  categories: Category[],
): CategoryGroup<GearItem>[] {
  const groups: CategoryGroup<GearItem>[] = categories.map((cat) => ({
    category: cat as Category | null,
    items: items.filter((i) => i.category_id === cat.id),
  }))
  const uncategorised = items.filter((i) => i.category_id === null)
  if (uncategorised.length > 0) groups.push({ category: null, items: uncategorised })
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
  return reorderedItems.map((i, idx) => ({ id: i.id, sort_order: slots[idx] }))
}
