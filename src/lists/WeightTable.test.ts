import { describe, it, expect, vi } from 'vitest'
import { computeWeightBreakdown } from '../lib/weight-breakdown'
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
    is_ready: false,
    sort_order: 0,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    gear_item: {
      id: `g-${overrides.id}`,
      name: `gear-${overrides.id}`,
      description: null,
      weight_grams: overrides.weight_grams,
      category_id: overrides.category_id,
      status: 'active',
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

  // M-10: a list_item with both is_consumable and is_worn true is impossible
  // per the worn_xor_consumable DB CHECK constraint, but if a future migration
  // relaxes the constraint or an optimistic-update path produces this state,
  // the helper warns and buckets the row's weight as consumable (the
  // historical precedence). Throwing would crash the list view on a
  // defensive guard for an unreachable case — wrong trade.
  it('warns and buckets as consumable when an impossible is_consumable+is_worn row appears', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const items = [
      listItem({
        id: 'impossible',
        category_id: shelter.id,
        weight_grams: 100,
        is_consumable: true,
        is_worn: true,
      }),
    ]

    const result = computeWeightBreakdown(items, [shelter])

    expect(warnSpy).toHaveBeenCalledWith(
      '[weight-table] list_item has both is_consumable and is_worn; bucketing as consumable',
      { listItemId: 'impossible', gearItemId: 'g-impossible' },
    )
    expect(result.consumableGrams).toBe(100)
    expect(result.wornGrams).toBe(0)
    expect(result.baseGrams).toBe(0)

    warnSpy.mockRestore()
  })
})
