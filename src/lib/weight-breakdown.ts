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

// Shared aggregation used by the detailed WeightTable and the mobile
// WeightSummary strip. Single source of truth for what counts as
// Base / Consumable / Worn / Total so the strip and table can never
// disagree on the headline number.
//
// TRANSPLANT NOTE (food): the old repo also exported withProjectedFood
// (compose projected food weight into consumable + pack total). That
// returns with the food-plans slice.
export function computeWeightBreakdown(
  items: ListItemWithGear[],
  categories: Category[],
): WeightBreakdown {
  const basePerCat = new Map<string | null, number>()
  let consumableGrams = 0
  let wornGrams = 0

  for (const item of items) {
    const w = item.gearItem.weightGrams * item.quantity
    // Defensive: the DB CHECK constraint forbids isConsumable + isWorn
    // both being true on the same list_item, but if a future migration
    // relaxes the constraint or an optimistic-update path produces this
    // impossible state, log it and pick consumable (the historical
    // precedence) so the page doesn't silently mis-bucket the weight.
    // Throwing instead would crash the list view on a defensive guard
    // for an unreachable case — the wrong trade.
    if (item.isConsumable && item.isWorn) {
      console.warn('[weight-breakdown] list_item has both isConsumable and isWorn; bucketing as consumable', {
        listItemId: item.id,
        gearItemId: item.gearItem.id,
      })
    }
    if (item.isConsumable) {
      consumableGrams += w
    } else if (item.isWorn) {
      wornGrams += w
    } else {
      // Route unknown category ids (cache drift between ['categories'] and
      // ['list-items']) to Uncategorized so their weight still sums into base.
      const raw = item.gearItem.categoryId
      const key = raw !== null && categories.some((c) => c.id === raw) ? raw : null
      basePerCat.set(key, (basePerCat.get(key) ?? 0) + w)
    }
  }

  const sortedCats = [...categories]
    .filter((c) => basePerCat.has(c.id))
    .sort((a, b) => a.sortOrder - b.sortOrder)

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
