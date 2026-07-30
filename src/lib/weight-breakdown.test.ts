import { describe, it, expect, vi } from 'vitest'
import {
  baseGramsForCategory,
  computeWeightBreakdown,
  consumableGramsForCategory,
} from './weight-breakdown'
import type { Category, ListItemWithGear } from './types'

// computeWeightBreakdown coverage (moved here from lists/WeightTable.test.ts,
// which named the WeightTable component but only exercised this helper). The
// component now has its own render test; this is the single home for the
// weight-breakdown module's pure-function coverage.

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

describe('computeWeightBreakdown', () => {
  // Regression test for B-1: when an item references a category id not present
  // in `categories` (cache drift between ['categories'] and ['list-items']),
  // its weight must route to Uncategorized so it still contributes to base.
  // Previously, orphan-keyed grams accumulated into a bucket that was never
  // read, and silently disappeared from the headline pack-weight number.
  it('routes orphan category ids to Uncategorized so base weight stays correct', () => {
    const items = [
      listItem({ id: '1', categoryId: 'orphan-uuid', weightGrams: 250 }),
    ]
    const result = computeWeightBreakdown(items, [shelter])

    expect(result.baseGrams).toBe(250)
    expect(result.catRows).toEqual([{ id: '__uncategorized__', name: 'Uncategorized', grams: 250 }])
  })

  it('multiplies weightGrams by quantity when accumulating base', () => {
    const items = [
      listItem({ id: '1', categoryId: shelter.id, weightGrams: 100, quantity: 3 }),
    ]
    const result = computeWeightBreakdown(items, [shelter])

    expect(result.baseGrams).toBe(300)
    expect(result.catRows).toEqual([{ id: shelter.id, name: 'Shelter', grams: 300 }])
  })

  // Component returns null on items.length === 0, so this just confirms the
  // helper produces a coherent zero-state in that case.
  it('returns zeroes and no rows for an empty items array', () => {
    const result = computeWeightBreakdown([], [shelter])

    expect(result.baseGrams).toBe(0)
    expect(result.consumableGrams).toBe(0)
    expect(result.wornGrams).toBe(0)
    expect(result.totalPackGrams).toBe(0)
    expect(result.catRows).toEqual([])
  })

  // M-10: a list_item with both isConsumable and isWorn true is impossible
  // per the worn_xor_consumable DB CHECK constraint, but if a future migration
  // relaxes the constraint or an optimistic-update path produces this state,
  // the helper warns and buckets the row's weight as consumable (the
  // historical precedence). Throwing would crash the list view on a
  // defensive guard for an unreachable case - wrong trade.
  it('warns and buckets as consumable when an impossible isConsumable+isWorn row appears', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const items = [
      listItem({
        id: 'impossible',
        categoryId: shelter.id,
        weightGrams: 100,
        isConsumable: true,
        isWorn: true,
      }),
    ]

    const result = computeWeightBreakdown(items, [shelter])

    expect(warnSpy).toHaveBeenCalledWith(
      '[weight-breakdown] list_item has both isConsumable and isWorn; bucketing as consumable',
      { listItemId: 'impossible', gearItemId: 'g-impossible' },
    )
    expect(result.consumableGrams).toBe(100)
    expect(result.wornGrams).toBe(0)
    expect(result.baseGrams).toBe(0)

    warnSpy.mockRestore()
  })
})


// baseGramsForCategory is the lookup that puts each rendered category section's
// footer subtotal onto computeWeightBreakdown, instead of the section summing
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
    return computeWeightBreakdown(
      [
        listItem({ id: 'tarp', categoryId: shelter.id, weightGrams: 400 }),
        // Same category, but consumable: must NOT reach the Shelter subtotal.
        listItem({ id: 'gas', categoryId: shelter.id, weightGrams: 230, isConsumable: true }),
        // Same category, worn: must NOT reach it either, regardless of any
        // display toggle. This is the half of the bug that was invisible.
        listItem({ id: 'jacket', categoryId: shelter.id, weightGrams: 550, isWorn: true }),
        // A category whose every item is consumable - absent from catRows.
        listItem({ id: 'bar', categoryId: consumables.id, weightGrams: 90, isConsumable: true }),
        listItem({ id: 'spork', categoryId: null, weightGrams: 17 }),
      ],
      [shelter, consumables],
    )
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

  it('returns 0 for a category id that does not exist at all', () => {
    expect(baseGramsForCategory(breakdown(), 'cat-nope')).toBe(0)
  })

  it('counts quantity and fractional gram weights', () => {
    const b = computeWeightBreakdown(
      [listItem({ id: 'stake', categoryId: shelter.id, weightGrams: 12.5, quantity: 4 })],
      [shelter],
    )
    expect(baseGramsForCategory(b, shelter.id)).toBe(50)
  })

  it('routes an orphan category id to Uncategorized, matching the grouper', () => {
    const b = computeWeightBreakdown(
      [
        listItem({ id: 'ghost', categoryId: 'cat-deleted', weightGrams: 60 }),
        listItem({ id: 'spork', categoryId: null, weightGrams: 17 }),
      ],
      [shelter],
    )
    expect(baseGramsForCategory(b, null)).toBe(77)
    expect(baseGramsForCategory(b, 'cat-deleted')).toBe(0)
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
    return computeWeightBreakdown(
      [
        listItem({ id: 'tent', categoryId: shelter.id, weightGrams: 1200 }),
        listItem({ id: 'gas', categoryId: shelter.id, weightGrams: 230, isConsumable: true }),
        listItem({ id: 'bar', categoryId: food.id, weightGrams: 45, quantity: 2, isConsumable: true }),
        listItem({ id: 'orphan', categoryId: 'cat-deleted', weightGrams: 20, isConsumable: true }),
        listItem({ id: 'uncat', categoryId: null, weightGrams: 15, isConsumable: true }),
      ],
      [shelter, food],
    )
  }

  it('returns only consumable gear in the requested category', () => {
    expect(consumableGramsForCategory(breakdown(), shelter.id)).toBe(230)
    expect(consumableGramsForCategory(breakdown(), food.id)).toBe(90)
  })

  it('routes orphan category ids to Uncategorized and counts quantity', () => {
    expect(consumableGramsForCategory(breakdown(), null)).toBe(35)
    expect(consumableGramsForCategory(breakdown(), 'cat-deleted')).toBe(0)
  })

  it('returns zero when a category contains no consumables', () => {
    const result = computeWeightBreakdown(
      [listItem({ id: 'tent', categoryId: shelter.id, weightGrams: 1200 })],
      [shelter],
    )
    expect(consumableGramsForCategory(result, shelter.id)).toBe(0)
  })

})
