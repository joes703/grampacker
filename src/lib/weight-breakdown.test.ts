import { describe, it, expect, vi } from 'vitest'
import { baseGramsForCategory, computeWeightBreakdown, withProjectedFood } from './weight-breakdown'
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

describe('withProjectedFood', () => {
  function baseBreakdown() {
    return computeWeightBreakdown(
      [
        listItem({ id: 'tent', categoryId: shelter.id, weightGrams: 1000 }),
        listItem({ id: 'bar', categoryId: null, weightGrams: 50, isConsumable: true }),
        listItem({ id: 'jacket', categoryId: null, weightGrams: 300, isWorn: true }),
      ],
      [shelter],
    )
  }

  it('adds food to consumable and the pack total, and nothing else', () => {
    const before = baseBreakdown()
    const after = withProjectedFood(before, 800)

    // Food is consumable by definition (design 5.3).
    expect(after.consumableGrams).toBe(before.consumableGrams + 800)
    expect(after.totalPackGrams).toBe(before.totalPackGrams + 800)

    // Untouched: food is not gear, so it has no category and no base weight,
    // and worn is excluded from the pack total entirely.
    expect(after.baseGrams).toBe(before.baseGrams)
    expect(after.wornGrams).toBe(before.wornGrams)
    expect(after.catRows).toEqual(before.catRows)
  })

  it('never adds a category row for food', () => {
    const after = withProjectedFood(baseBreakdown(), 800)
    // Only the gear categories. Food has no category and cannot be an
    // Uncategorized row either - it is not a list_items row at all.
    expect(after.catRows.map((r) => r.name)).toEqual(['Shelter'])
  })

  it('returns the breakdown unchanged when no food projects', () => {
    const before = baseBreakdown()
    expect(withProjectedFood(before, 0)).toBe(before)
  })

  it('does not mutate the breakdown it is given', () => {
    const before = baseBreakdown()
    const snapshot = structuredClone(before)
    withProjectedFood(before, 800)
    expect(before).toEqual(snapshot)
  })

  it('carries a food-only list: no gear, food is the whole pack', () => {
    const empty = computeWeightBreakdown([], [])
    const after = withProjectedFood(empty, 1200)
    expect(after.totalPackGrams).toBe(1200)
    expect(after.consumableGrams).toBe(1200)
    expect(after.baseGrams).toBe(0)
    expect(after.catRows).toEqual([])
  })
})

// baseGramsForCategory is the lookup that puts each rendered category section's
// footer subtotal onto computeWeightBreakdown, instead of the section summing
// its own rows (which counted consumables into the subtotal, and counted worn
// items too whenever the list's Group Worn toggle happened to be off).
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

  it('is unaffected by projected food weight', () => {
    // Food moves consumable + total only; no category subtotal may move.
    const b = withProjectedFood(breakdown(), 1200)
    expect(baseGramsForCategory(b, shelter.id)).toBe(400)
    expect(baseGramsForCategory(b, null)).toBe(17)
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
