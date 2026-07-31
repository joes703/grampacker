import type { ListItemWithGear, Category } from './types'

// Stable row identity for React keys. Real categories use their uuid;
// the synthetic Uncategorized row uses the same '__uncategorized__'
// sentinel as GearLibraryPage to avoid colliding with any real id.
export type WeightBreakdown = {
  catRows: { id: string; name: string; grams: number }[]
  consumableCatRows: { id: string; name: string; grams: number }[]
  baseGrams: number
  consumableGrams: number
  wornGrams: number
  totalPackGrams: number
}

// Shared aggregation used by the detailed WeightTable and the mobile
// WeightSummary strip. Single source of truth for what counts as
// Base / Consumable / Worn / Total so the strip and table can never
// disagree on the headline number.
export function computeWeightBreakdown(
  items: ListItemWithGear[],
  categories: Category[],
): WeightBreakdown {
  const basePerCat = new Map<string | null, number>()
  const consumablePerCat = new Map<string | null, number>()
  const knownCategoryIds = new Set(categories.map((category) => category.id))
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
      const raw = item.gearItem.categoryId
      const key = raw !== null && knownCategoryIds.has(raw) ? raw : null
      consumablePerCat.set(key, (consumablePerCat.get(key) ?? 0) + w)
    } else if (item.isWorn) {
      wornGrams += w
    } else {
      // Route unknown category ids (cache drift between ['categories'] and
      // ['list-items']) to Uncategorized so their weight still sums into base.
      const raw = item.gearItem.categoryId
      const key = raw !== null && knownCategoryIds.has(raw) ? raw : null
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

  const consumableCatRows = [...categories]
    .filter((category) => consumablePerCat.has(category.id))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      id: category.id,
      name: category.name,
      grams: consumablePerCat.get(category.id) ?? 0,
    }))
  const uncategorizedConsumableGrams = consumablePerCat.get(null)
  if (uncategorizedConsumableGrams !== undefined) {
    consumableCatRows.push({
      id: UNCATEGORIZED_ROW_ID,
      name: 'Uncategorized',
      grams: uncategorizedConsumableGrams,
    })
  }

  const baseGrams = catRows.reduce((s, r) => s + r.grams, 0)
  const totalPackGrams = baseGrams + consumableGrams

  return { catRows, consumableCatRows, baseGrams, consumableGrams, wornGrams, totalPackGrams }
}

// Sentinel row id for Uncategorized inside `catRows`. Exported so callers can
// map a rendered section's `category: null` onto the right row instead of
// re-spelling the literal.
export const UNCATEGORIZED_ROW_ID = '__uncategorized__'

// Per-section base subtotal, for the footer under each rendered category.
//
// This exists so a category section CANNOT compute its own subtotal. It used
// to: CategoryGroup summed its own rows, which meant consumables and worn items
// landed in the subtotal, so display details silently redefined a weight metric, and
// the subtotals never summed to the summary's Base weight.
//
// Returns BASE grams only: consumable and worn weight are excluded, always and
// regardless of any display toggle. Because that makes the number no longer the
// arithmetic sum of the visible rows, the footer labels it ("Base:") rather
// than presenting a bare figure that promises to add up.
//
// `catRows` omits any category with no base weight, so a missing row is a real
// zero, not a lookup failure - a consumable-only category must render 0, never
// fall through to another section's number.
export function baseGramsForCategory(
  breakdown: WeightBreakdown,
  categoryId: string | null,
): number {
  const rowId = categoryId ?? UNCATEGORIZED_ROW_ID
  return breakdown.catRows.find((r) => r.id === rowId)?.grams ?? 0
}

/** Per-section consumable gear subtotal. */
export function consumableGramsForCategory(
  breakdown: WeightBreakdown,
  categoryId: string | null,
): number {
  const rowId = categoryId ?? UNCATEGORIZED_ROW_ID
  return breakdown.consumableCatRows.find((row) => row.id === rowId)?.grams ?? 0
}

/**
 * Total grams of carried food.
 *
 * Sums over ITEMS ALONE. An item associated with five lunch slots contributes
 * its weight ONCE - the associations say when you intend to eat it, not how
 * many of it you carry. Summing across a join of items to slots is the single
 * most dangerous query in this feature: for one 500 g bag of trail mix eaten
 * across five lunches it returns 2500 g, and pack weight is the number the
 * whole app exists to produce.
 */
export function foodGramsFor(
  items: readonly { weightGrams: number; quantity: number }[],
): number {
  return items.reduce((grams, item) => grams + item.weightGrams * item.quantity, 0)
}

/**
 * Compose carried food into a gear breakdown.
 *
 * Food is ALWAYS consumable - by definition, not by user choice - so only
 * consumableGrams and totalPackGrams move. baseGrams, wornGrams and every
 * per-category row are untouched: food is not gear, has no category, and is
 * not a list_items row, so it can never belong in a category footer.
 */
export function withFoodWeight(
  breakdown: WeightBreakdown,
  foodGrams: number,
): WeightBreakdown {
  if (foodGrams === 0) return breakdown
  return {
    ...breakdown,
    consumableGrams: breakdown.consumableGrams + foodGrams,
    totalPackGrams: breakdown.totalPackGrams + foodGrams,
  }
}
