import { describe, it, expect } from 'vitest'
import { computeWeightBreakdown } from './WeightTable'
import type { Category, ListItemWithGear } from '../lib/types'

function listItem(overrides: {
  id: string
  category_id: string | null
  weight_grams: number
  quantity?: number
  is_worn?: boolean
  is_consumable?: boolean
}): ListItemWithGear {
  return {
    id: overrides.id,
    list_id: 'l-1',
    user_id: 'u',
    gear_item_id: `g-${overrides.id}`,
    quantity: overrides.quantity ?? 1,
    is_worn: overrides.is_worn ?? false,
    is_consumable: overrides.is_consumable ?? false,
    is_packed: false,
    sort_order: 0,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    gear_item: {
      id: `g-${overrides.id}`,
      name: `gear-${overrides.id}`,
      description: null,
      weight_grams: overrides.weight_grams,
      category_id: overrides.category_id,
    },
  }
}

const shelter: Category = {
  id: 'cat-shelter',
  user_id: 'u',
  name: 'Shelter',
  sort_order: 0,
  is_default: true,
  created_at: '2024-01-01',
}

describe('computeWeightBreakdown', () => {
  // Regression test for B-1: when an item references a category id not present
  // in `categories` (cache drift between ['categories'] and ['list-items']),
  // its weight must route to Uncategorized so it still contributes to base.
  // Previously, orphan-keyed grams accumulated into a bucket that was never
  // read, and silently disappeared from the headline pack-weight number.
  it('routes orphan category ids to Uncategorized so base weight stays correct', () => {
    const items = [
      listItem({ id: '1', category_id: 'orphan-uuid', weight_grams: 250 }),
    ]
    const result = computeWeightBreakdown(items, [shelter])

    expect(result.baseGrams).toBe(250)
    expect(result.catRows).toEqual([{ id: '__uncategorized__', name: 'Uncategorized', grams: 250 }])
  })

  it('multiplies weight_grams by quantity when accumulating base', () => {
    const items = [
      listItem({ id: '1', category_id: shelter.id, weight_grams: 100, quantity: 3 }),
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
})
