import { describe, it, expect } from 'vitest'
import {
  baseGramsForCategory,
  computeListWeightBreakdown,
  foodGramsFor,
  consumableGramsForCategory,
  wornGramsForCategory,
} from './weight-breakdown'
import type { Category, ListItemWithGear } from './types'

// Pure-function coverage for the weight-breakdown module. The WeightTable
// component has its own render test.

function listItem(overrides: {
  id: string
  categoryId: string | null
  weightGrams: number
  quantity?: number
  isWorn?: boolean
  isConsumable?: boolean
  packingLocationId?: string | null
}): ListItemWithGear {
  return {
    id: overrides.id,
    listId: 'l-1',
    gearItemId: `g-${overrides.id}`,
    quantity: overrides.quantity ?? 1,
    isWorn: overrides.isWorn ?? false,
    isConsumable: overrides.isConsumable ?? false,
    isPacked: false,
    isReady: false,
    packingLocationId: overrides.packingLocationId ?? null,
    sortOrder: 0,
    packSortOrder: 0,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    gearItem: {
      id: `g-${overrides.id}`,
      name: `gear-${overrides.id}`,
      description: null,
      weightGrams: overrides.weightGrams,
      categoryId: overrides.categoryId,
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder: 0,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    },
  }
}

const shelter: Category = {
  id: 'cat-shelter',
  name: 'Shelter',
  sortOrder: 0,
  createdAt: '2024-01-01',
}

describe('computeListWeightBreakdown', () => {
  // When an item references a category id not present in `categories` (cache
  // drift between ['categories'] and ['list-items']), its weight must route to
  // Uncategorized so it still contributes to base. Grams kept under the orphan
  // key would land in a bucket nothing reads, and silently drop out of the
  // headline pack-weight number. The orphan and the null item share one row,
  // matching the grouper, so their grams must add up.
  it('routes orphan category ids to Uncategorized so base weight stays correct', () => {
    const items = [
      listItem({ id: '1', categoryId: 'orphan-uuid', weightGrams: 250 }),
      listItem({ id: '2', categoryId: null, weightGrams: 17 }),
    ]
    const result = computeListWeightBreakdown({ gear: { items: items, categories: [shelter] }, food: { grams: 0 } })

    expect(result.baseGrams).toBe(267)
    expect(result.catRows).toEqual([{ id: '__uncategorized__', name: 'Uncategorized', grams: 267 }])
  })

  it('multiplies weightGrams by quantity when accumulating base', () => {
    // A fractional weight, so rounding the per-item grams also fails here.
    const items = [
      listItem({ id: '1', categoryId: shelter.id, weightGrams: 12.5, quantity: 4 }),
    ]
    const result = computeListWeightBreakdown({ gear: { items: items, categories: [shelter] }, food: { grams: 0 } })

    expect(result.baseGrams).toBe(50)
    expect(result.catRows).toEqual([{ id: shelter.id, name: 'Shelter', grams: 50 }])
  })

  // Component returns null on items.length === 0, so this just confirms the
  // helper produces a coherent zero-state in that case.
  it('returns zeroes and no rows for an empty items array', () => {
    const result = computeListWeightBreakdown({ gear: { items: [], categories: [shelter] }, food: { grams: 0 } })

    expect(result.baseGrams).toBe(0)
    expect(result.consumableGrams).toBe(0)
    expect(result.wornGrams).toBe(0)
    expect(result.totalPackGrams).toBe(0)
    expect(result.catRows).toEqual([])
  })
})


// baseGramsForCategory is the lookup that puts each rendered category section's
// footer subtotal onto the shared breakdown, instead of the section summing
// its own rows (which counted consumables and worn items into the subtotal).
//
// The three traps this owns, all of which produce a plausible-looking wrong
// number rather than a crash:
//   1. catRows OMITS categories with no base weight, so a consumable-only
//      category is absent from the map entirely. That must read as 0, not as
//      "missing" - and definitely not fall through to some other row.
//   2. catRows keys Uncategorized by the '__uncategorized__' sentinel, while
//      the rendering grouper keys it `category: null`.
//   3. The Worn pseudo-section passes NO categoryId. Treating that undefined
//      as null would hand it the Uncategorized subtotal.
describe('baseGramsForCategory', () => {
  const consumables: Category = { id: 'cat-food', name: 'Food', sortOrder: 1, createdAt: '2024-01-01' }

  function breakdown() {
    return computeListWeightBreakdown({
      gear: {
        items: [
            listItem({ id: 'tarp', categoryId: shelter.id, weightGrams: 400 }),
            // Same category, but consumable: must NOT reach the Shelter subtotal.
            listItem({ id: 'gas', categoryId: shelter.id, weightGrams: 230, isConsumable: true }),
            // Same category, worn: must NOT reach it either, regardless of any
            // display toggle.
            listItem({ id: 'jacket', categoryId: shelter.id, weightGrams: 550, isWorn: true }),
            // A category whose every item is consumable - absent from catRows.
            listItem({ id: 'bar', categoryId: consumables.id, weightGrams: 90, isConsumable: true }),
            listItem({ id: 'spork', categoryId: null, weightGrams: 17 }),
          ],
        categories: [shelter, consumables],
      },
      food: { grams: 0 },
    })
  }

  it('returns only the category base weight, excluding consumable and worn', () => {
    expect(baseGramsForCategory(breakdown(), shelter.id)).toBe(400)
  })

  it('returns 0 for a category that is absent from catRows because it has no base weight', () => {
    // Trap 1. Food holds a real 90g item, so "is it missing?" and "is it zero?"
    // are different questions with the same answer here - and only 0 is safe.
    expect(baseGramsForCategory(breakdown(), consumables.id)).toBe(0)
  })

  it('maps a null categoryId onto the Uncategorized sentinel row', () => {
    // Trap 2.
    expect(baseGramsForCategory(breakdown(), null)).toBe(17)
  })

  it('category subtotals sum to baseGrams', () => {
    const b = breakdown()
    const summed = baseGramsForCategory(b, shelter.id)
      + baseGramsForCategory(b, consumables.id)
      + baseGramsForCategory(b, null)
    expect(summed).toBe(b.baseGrams)
  })
})

describe('consumableGramsForCategory', () => {
  const food: Category = { id: 'cat-food', name: 'Food', sortOrder: 1, createdAt: '2024-01-01' }

  function breakdown() {
    return computeListWeightBreakdown({
      gear: {
        items: [
            listItem({ id: 'tent', categoryId: shelter.id, weightGrams: 1200 }),
            listItem({ id: 'gas', categoryId: shelter.id, weightGrams: 230, isConsumable: true }),
            listItem({ id: 'bar', categoryId: food.id, weightGrams: 45, quantity: 2, isConsumable: true }),
            listItem({ id: 'orphan', categoryId: 'cat-deleted', weightGrams: 20, isConsumable: true }),
            listItem({ id: 'uncat', categoryId: null, weightGrams: 15, isConsumable: true }),
          ],
        categories: [shelter, food],
      },
      food: { grams: 0 },
    })
  }

  it('returns only consumable gear in the requested category', () => {
    expect(consumableGramsForCategory(breakdown(), shelter.id)).toBe(230)
    expect(consumableGramsForCategory(breakdown(), food.id)).toBe(90)
  })

  it('routes orphan category ids to Uncategorized and counts quantity', () => {
    expect(consumableGramsForCategory(breakdown(), null)).toBe(35)
    expect(consumableGramsForCategory(breakdown(), 'cat-deleted')).toBe(0)
  })

})

// Worn rows now render inside their category (pack mode still extracts them),
// so the category footer needs the same per-section answer for worn that it
// has for base and consumable - computed once here, never summed from rows.
describe('wornGramsForCategory', () => {
  function breakdown() {
    return computeListWeightBreakdown({
      gear: {
        items: [
          listItem({ id: 'tent', categoryId: shelter.id, weightGrams: 900 }),
          listItem({ id: 'shirt', categoryId: shelter.id, weightGrams: 150, quantity: 2, isWorn: true }),
          listItem({ id: 'hat', categoryId: 'cat-deleted', weightGrams: 60, isWorn: true }),
        ],
        categories: [shelter],
      },
      food: { grams: 0 },
    })
  }

  it('returns only worn gear in the requested category, counting quantity', () => {
    expect(wornGramsForCategory(breakdown(), shelter.id)).toBe(300)
  })

  it('routes orphan category ids to Uncategorized', () => {
    expect(wornGramsForCategory(breakdown(), null)).toBe(60)
    expect(wornGramsForCategory(breakdown(), 'cat-deleted')).toBe(0)
  })

  it('keeps worn weight out of base, and the per-category figures sum to wornGrams', () => {
    const b = breakdown()
    expect(baseGramsForCategory(b, shelter.id)).toBe(900)
    expect(wornGramsForCategory(b, shelter.id) + wornGramsForCategory(b, null)).toBe(b.wornGrams)
  })
})

describe('food weight', () => {
  const GEAR = {
    items: [
      listItem({ id: 'a', categoryId: 'cat-1', weightGrams: 1200 }),
      listItem({ id: 'b', categoryId: 'cat-1', weightGrams: 230, isConsumable: true }),
    ],
    categories: [{ id: 'cat-1', name: 'Shelter', sortOrder: 0, createdAt: '2024-01-01' }],
  }
  const withFood = (grams: number) =>
    computeListWeightBreakdown({ gear: GEAR, food: { grams } })

  // Local fixture: the other describes each scope their own `breakdown()`.
  const breakdown = () =>
    computeListWeightBreakdown({
      gear: {
        items: [
          listItem({ id: 'a', categoryId: 'cat-1', weightGrams: 1200 }),
          listItem({ id: 'b', categoryId: 'cat-1', weightGrams: 230, isConsumable: true }),
        ],
        categories: [{ id: 'cat-1', name: 'Shelter', sortOrder: 0, createdAt: '2024-01-01' }],
      },
      food: { grams: 0 },
    })

  it('multiplies by quantity, which is UNITS CARRIED', () => {
    // Four oatmeal packets is four packets - that is the user telling us, not
    // us inferring it from four breakfast slots.
    expect(foodGramsFor([{ weightGrams: 80, unitCount: 4 }])).toBe(320)
  })

  it('sums several carried items', () => {
    // foodGramsFor takes items, never slots: one 500 g bag of trail mix eaten
    // across five lunches weighs 500 g. Summing across the item->slot
    // associations would say 2500, and pack weight is the number this app
    // exists to produce.
    expect(
      foodGramsFor([
        { weightGrams: 500, unitCount: 1 },
        { weightGrams: 80, unitCount: 4 },
        { weightGrams: 15, unitCount: 6 },
      ]),
    ).toBe(910)
  })

  it('is zero for no food', () => {
    expect(foodGramsFor([])).toBe(0)
  })

  it('moves consumable and total only, never base, worn or a category row', () => {
    // Food is not gear: it has no category and must never land in a category
    // footer, or the per-section subtotals stop summing to the whole.
    const before = breakdown()
    const after = withFood(800)

    expect(after.consumableGrams).toBe(before.consumableGrams + 800)
    expect(after.totalPackGrams).toBe(before.totalPackGrams + 800)
    expect(after.baseGrams).toBe(before.baseGrams)
    expect(after.wornGrams).toBe(before.wornGrams)
    expect(after.catRows).toEqual(before.catRows)
    expect(after.consumableCatRows).toEqual(before.consumableCatRows)
  })

  // Why this contract exists: if a caller could omit food, the public share
  // could report a lighter pack than the owner sees, and nothing would say
  // the result was unfinished. Food is a REQUIRED input, so the share and
  // owner pages cannot compute different totals from the same list without
  // someone deliberately passing a different number.
  //
  // The type check in `npm run build` is the assertion: if `food` became
  // optional, this directive would be unused and the build would fail. The
  // function is never called.
  it('cannot be computed without stating what food contributes', () => {
    // @ts-expect-error food is a required input
    const omitFood = () => computeListWeightBreakdown({ gear: { items: [], categories: [] } })
    void omitFood
  })
})
