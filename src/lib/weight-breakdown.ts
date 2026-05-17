import type { ListItemWithGear, Category } from './types'

// Stable row identity for React keys. Real categories use their uuid;
// the synthetic Uncategorized row uses the same '__uncategorized__'
// sentinel as GearLibraryPage to avoid colliding with any real id.
export type WeightBreakdown = {
  catRows: { id: string; name: string; grams: number }[]
  baseGrams: number
  consumableGrams: number
  wornGrams: number
  totalPackGrams: number
}

// Shared aggregation used by the detailed WeightTable, the mobile
// WeightSummary strip, and the share-view panel. Single source of truth
// for what counts as Base / Consumable / Worn / Total so the strip and
// table can never disagree on the headline number.
export function computeWeightBreakdown(
  items: ListItemWithGear[],
  categories: Category[],
): WeightBreakdown {
  const basePerCat = new Map<string | null, number>()
  let consumableGrams = 0
  let wornGrams = 0

  for (const item of items) {
    const w = item.gear_item.weight_grams * item.quantity
    // Defensive: the DB CHECK constraint forbids is_consumable +
    // is_worn both being true on the same list_item, but if a future
    // migration relaxes the constraint or an optimistic-update path
    // produces this impossible state, log it and pick consumable (the
    // historical precedence) so the page doesn't silently mis-bucket
    // the weight. Throwing instead would crash the list view on a
    // defensive guard for an unreachable case — the wrong trade.
    if (item.is_consumable && item.is_worn) {
      console.warn('[weight-table] list_item has both is_consumable and is_worn; bucketing as consumable', {
        listItemId: item.id,
        gearItemId: item.gear_item.id,
      })
    }
    if (item.is_consumable) {
      consumableGrams += w
    } else if (item.is_worn) {
      wornGrams += w
    } else {
      // Route unknown category ids (cache drift between ['categories'] and
      // ['list-items']) to Uncategorized so their weight still sums into base.
      const raw = item.gear_item.category_id
      const key = raw !== null && categories.some((c) => c.id === raw) ? raw : null
      basePerCat.set(key, (basePerCat.get(key) ?? 0) + w)
    }
  }

  const sortedCats = [...categories]
    .filter((c) => basePerCat.has(c.id))
    .sort((a, b) => a.sort_order - b.sort_order)

  const catRows = sortedCats.map((c) => {
    const grams = basePerCat.get(c.id)
    if (grams === undefined) throw new Error('computeWeightBreakdown: filtered key missing (unreachable)')
    return { id: c.id, name: c.name, grams }
  })
  const uncatGrams = basePerCat.get(null)
  if (uncatGrams !== undefined) {
    catRows.push({ id: '__uncategorized__', name: 'Uncategorized', grams: uncatGrams })
  }

  const baseGrams = catRows.reduce((s, r) => s + r.grams, 0)
  const totalPackGrams = baseGrams + consumableGrams

  return { catRows, baseGrams, consumableGrams, wornGrams, totalPackGrams }
}
