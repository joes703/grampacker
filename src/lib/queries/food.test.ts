import { describe, it, expect } from 'vitest'
import { nextFoodItemSortOrder, assertFoodItemWithinCap } from './food'
import { FOOD_ITEM_CAP } from '../caps'
import type { FoodItem } from '../types'

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
