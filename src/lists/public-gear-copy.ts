import type { ListImportRow } from '../lib/csv'
import { MAX_NAME_LENGTH } from '../lib/caps'
import type { PublicCategory, PublicListItem } from '../lib/types'

export function publicGearItemsToImportRows(
  items: PublicListItem[],
  categories: PublicCategory[],
): ListImportRow[] {
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]))
  return items
    .toSorted((a, b) => a.sort_order - b.sort_order)
    .map((item) => ({
      name: item.gear_item.name,
      description: item.gear_item.description,
      weight_grams: item.gear_item.weight_grams,
      category: item.gear_item.category_id
        ? (categoryNameById.get(item.gear_item.category_id) ?? '')
        : '',
      quantity: item.quantity,
      is_worn: item.is_worn,
      is_consumable: item.is_consumable,
    }))
}

export function copiedPublicListName(name: string): string {
  const suffix = ' (copy)'
  const base = name.trim() || 'Shared list'
  return `${base.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`
}
