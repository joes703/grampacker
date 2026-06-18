import { describe, it, expect, vi, beforeEach } from 'vitest'

// food.ts imports ../supabase, whose module-eval throws when VITE_SUPABASE_URL
// is unset (CI has no .env), so the client must be mocked. The pure-helper
// tests below never touch the client; the fetchFoodItemsLite tests assert the
// exact column projection on the builder chain:
//   from(table).select(cols).eq(col, val).order(col, opts) -> { data, error }
const sb = vi.hoisted(() => ({
  order: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
}))

vi.mock('../supabase', () => ({ supabase: { from: (t: string) => sb.from(t) } }))

import { nextFoodItemSortOrder, assertFoodItemWithinCap, fetchFoodItemsLite } from './food'
import { FOOD_ITEM_CAP } from '../caps'
import type { FoodItem } from '../types'

beforeEach(() => {
  vi.clearAllMocks()
  sb.order.mockResolvedValue({ data: [], error: null })
  sb.eq.mockReturnValue({ order: sb.order })
  sb.select.mockReturnValue({ eq: sb.eq })
  sb.from.mockReturnValue({ select: sb.select })
})

function food(partial: Partial<FoodItem>): FoodItem {
  return {
    id: 'x',
    user_id: 'u',
    name: 'F',
    brand: null,
    serving_description: null,
    serving_weight_grams: 50,
    calories_per_serving: 100,
    servings_per_package: null,
    fat_grams: null,
    saturated_fat_grams: null,
    carbs_grams: null,
    fiber_grams: null,
    sugar_grams: null,
    protein_grams: null,
    sodium_mg: null,
    potassium_mg: null,
    notes: null,
    sort_order: 0,
    created_at: '',
    updated_at: '',
    ...partial,
  }
}

describe('nextFoodItemSortOrder', () => {
  it('returns 0 for an empty library', () => {
    expect(nextFoodItemSortOrder([])).toBe(0)
  })
  it('returns one past the current max sort_order', () => {
    expect(nextFoodItemSortOrder([food({ sort_order: 2 }), food({ sort_order: 7 })])).toBe(8)
  })
})

describe('assertFoodItemWithinCap', () => {
  it('allows adding when under the cap', () => {
    expect(() => assertFoodItemWithinCap([food({})])).not.toThrow()
  })
  it('throws when already at the cap', () => {
    const full = Array.from({ length: FOOD_ITEM_CAP }, (_, i) => food({ id: String(i) }))
    expect(() => assertFoodItemWithinCap(full)).toThrow(/full/i)
  })
})

describe('fetchFoodItemsLite', () => {
  it('selects only the six lite columns, owner-scoped and ordered by name', async () => {
    await fetchFoodItemsLite('user-1')
    expect(sb.from).toHaveBeenCalledWith('food_items')
    expect(sb.select).toHaveBeenCalledWith(
      'id, name, brand, serving_weight_grams, calories_per_serving, servings_per_package',
    )
    expect(sb.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(sb.order).toHaveBeenCalledWith('name', { ascending: true })
  })

  it('throws when Supabase returns an error', async () => {
    sb.order.mockResolvedValueOnce({ data: null, error: new Error('boom') })
    await expect(fetchFoodItemsLite('user-1')).rejects.toThrow('boom')
  })
})
