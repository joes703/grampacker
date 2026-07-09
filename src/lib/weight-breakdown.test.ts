import { describe, it, expect, vi } from 'vitest'
import { computeWeightBreakdown } from './weight-breakdown'
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
