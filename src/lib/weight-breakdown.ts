import type { ListItemWithGear, Category } from './types'

// Stable row identity for React keys. Real categories use their uuid;
// the synthetic Uncategorized row uses the same '__uncategorized__'
// sentinel as GearLibraryPage to avoid colliding with any real id.
// Branded, and that brand is load-bearing rather than ceremony. Without it
// this is a plain structural type: any caller could assemble an object with
// the right fields and hand it to WeightTable - a total that looks finished
// and is not, which is the bug this module prevents. The symbol is not
// exported, so the only way to obtain one is computeListWeightBreakdown,
// which cannot be called without stating what every contributor adds.
declare const COMPLETE: unique symbol

export type WeightBreakdown = {
  readonly [COMPLETE]: true
  catRows: { id: string; name: string; grams: number }[]
  consumableCatRows: { id: string; name: string; grams: number }[]
  wornCatRows: { id: string; name: string; grams: number }[]
  baseGrams: number
  consumableGrams: number
  wornGrams: number
  totalPackGrams: number
}

// The GEAR-ONLY reducer. Deliberately NOT exported: its result is an
// incomplete pack weight. A caller that treated it as finished (the public
// share, say) would report a lighter pack than the owner sees, and nothing
// would say it was unfinished.
//
// Reach it through computeListWeightBreakdown, which cannot be called without
// deciding what every contributor adds.
// The gear reducer's own result: the same fields WITHOUT the completeness
// brand, so it cannot reach a display component by accident.
type GearOnlyBreakdown = Omit<WeightBreakdown, typeof COMPLETE>

function computeGearWeightBreakdown(
  items: ListItemWithGear[],
  categories: Category[],
): GearOnlyBreakdown {
  const basePerCat = new Map<string | null, number>()
  const consumablePerCat = new Map<string | null, number>()
  const wornPerCat = new Map<string | null, number>()
  const knownCategoryIds = new Set(categories.map((category) => category.id))
  let consumableGrams = 0
  let wornGrams = 0

  for (const item of items) {
    const w = item.gearItem.weightGrams * item.quantity
    if (item.isConsumable) {
      consumableGrams += w
      const raw = item.gearItem.categoryId
      const key = raw !== null && knownCategoryIds.has(raw) ? raw : null
      consumablePerCat.set(key, (consumablePerCat.get(key) ?? 0) + w)
    } else if (item.isWorn) {
      wornGrams += w
      const raw = item.gearItem.categoryId
      const key = raw !== null && knownCategoryIds.has(raw) ? raw : null
      wornPerCat.set(key, (wornPerCat.get(key) ?? 0) + w)
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
    if (grams === undefined) throw new Error('weight-breakdown: filtered key missing (unreachable)')
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

  const wornCatRows = [...categories]
    .filter((category) => wornPerCat.has(category.id))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      id: category.id,
      name: category.name,
      grams: wornPerCat.get(category.id) ?? 0,
    }))
  const uncategorizedWornGrams = wornPerCat.get(null)
  if (uncategorizedWornGrams !== undefined) {
    wornCatRows.push({
      id: UNCATEGORIZED_ROW_ID,
      name: 'Uncategorized',
      grams: uncategorizedWornGrams,
    })
  }

  const baseGrams = catRows.reduce((s, r) => s + r.grams, 0)
  const totalPackGrams = baseGrams + consumableGrams

  return { catRows, consumableCatRows, wornCatRows, baseGrams, consumableGrams, wornGrams, totalPackGrams }
}

// Sentinel row id for Uncategorized inside `catRows`. Exported so callers can
// map a rendered section's `category: null` onto the right row instead of
// re-spelling the literal.
const UNCATEGORIZED_ROW_ID = '__uncategorized__'

// Per-section base subtotal, for the footer under each rendered category.
//
// This exists so a category section CANNOT compute its own subtotal: summing
// its own rows would put consumables and worn items in the subtotal, and the
// subtotals would never sum to the summary's Base weight.
//
// Returns BASE grams only: consumable and worn weight are excluded, always and
// regardless of any display toggle. Because that makes the number not the
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

/** Per-section worn gear subtotal. Worn rows render inside their category in
 *  the Category arrangement and the share (pack mode still extracts them), so
 *  the footer needs this answer the same way it needs base and consumable:
 *  from here, never summed from rendered rows. */
export function wornGramsForCategory(
  breakdown: WeightBreakdown,
  categoryId: string | null,
): number {
  const rowId = categoryId ?? UNCATEGORIZED_ROW_ID
  return breakdown.wornCatRows.find((row) => row.id === rowId)?.grams ?? 0
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
/**
 * Weight at ONE SITTING - what a single meal's row adds up to.
 *
 * `quantity`, not `unitCount`: unitCount is the whole trip's worth, and a
 * lunch does not weigh five lunches. For a shared stash this is the whole
 * stash, the same as it has always been, which is why the DAY total below has
 * to dedupe shared items and must NOT dedupe per-meal ones.
 */
export function foodGramsAtOneMeal(
  items: readonly { weightGrams: number; quantity: number }[],
): number {
  return items.reduce((grams, item) => grams + item.weightGrams * item.quantity, 0)
}

export function foodGramsFor(
  items: readonly { weightGrams: number; unitCount: number }[],
): number {
  // unitCount, never quantity. quantity is per-MEAL for most items, and
  // summing it counts one packet for a five-lunch plan - an under-report. The server resolves unitCount so every
  // surface, including the anonymous share, sums the same number.
  return items.reduce((grams, item) => grams + item.weightGrams * item.unitCount, 0)
}

/**
 * Every contributor to a pack's weight. One entry per kind, all REQUIRED.
 *
 * Requiredness is the whole point. An optional `food` step is one a caller
 * can forget, and then a shared list silently reports a lighter pack than
 * the same list does to its owner. Adding a third contributor here breaks every
 * call site until each one says what it does with it, which is the behavior
 * a convention could never guarantee.
 *
 * `food.grams` is 0 when there is no food, never omitted and never null.
 */
export type ListWeightInputs = {
  gear: {
    items: ListItemWithGear[]
    categories: Category[]
  }
  food: {
    grams: number
  }
}

/**
 * The only way to obtain a WeightBreakdown. Display components accept nothing
 * else, so a partial total cannot reach a screen.
 *
 * Food is ALWAYS consumable - by definition, not by user choice - so only
 * consumableGrams and totalPackGrams move. baseGrams, wornGrams and every
 * per-category row are untouched: food is not gear, has no category, and is
 * not a list_items row, so it can never belong in a category footer.
 */
export function computeListWeightBreakdown(inputs: ListWeightInputs): WeightBreakdown {
  const gear = computeGearWeightBreakdown(inputs.gear.items, inputs.gear.categories)
  const foodGrams = inputs.food.grams
  // The cast is the single place completeness is asserted, and it is sound
  // exactly here: every contributor in ListWeightInputs has been folded in
  // above. Nowhere else may produce this type.
  return {
    ...gear,
    consumableGrams: gear.consumableGrams + foodGrams,
    totalPackGrams: gear.totalPackGrams + foodGrams,
  } as WeightBreakdown
}
