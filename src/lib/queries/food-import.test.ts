import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  inserted: null as unknown[] | null,
  table: null as string | null,
  error: null as { message: string } | null,
}))

vi.mock('../supabase', () => ({
  supabase: {
    from(table: string) {
      mockState.table = table
      return {
        insert(rows: unknown[]) {
          mockState.inserted = rows
          return Promise.resolve({ error: mockState.error })
        },
      }
    },
  },
}))

import { importFoodItems, assertFoodImportWithinCap } from './food'
import { FOOD_ITEM_CAP } from '../caps'
import type { FoodItem } from '../types'
import type { FoodItemInput } from './food'

function existingFood(partial: Partial<FoodItem>): FoodItem {
  return {
    id: 'x', user_id: 'u', name: 'F', brand: null, serving_description: null,
    serving_weight_grams: 50, calories_per_serving: 100, servings_per_package: null,
    fat_grams: null, saturated_fat_grams: null, carbs_grams: null, fiber_grams: null,
    sugar_grams: null, protein_grams: null, sodium_mg: null, potassium_mg: null,
    notes: null, sort_order: 0, created_at: '', updated_at: '', ...partial,
  }
}

function input(name: string): FoodItemInput {
  return {
    name, brand: null, serving_description: null, serving_weight_grams: 50,
    calories_per_serving: 100, servings_per_package: null, fat_grams: null,
    saturated_fat_grams: null, carbs_grams: null, fiber_grams: null, sugar_grams: null,
    protein_grams: null, sodium_mg: null, potassium_mg: null, notes: null,
  }
}

describe('assertFoodImportWithinCap', () => {
  it('allows an import that exactly fills the cap', () => {
    const existing = Array.from({ length: FOOD_ITEM_CAP - 2 }, (_, i) => existingFood({ id: String(i) }))
    expect(() => assertFoodImportWithinCap(existing, 2)).not.toThrow()
  })
  it('throws when existing + incoming exceeds the cap', () => {
    const existing = Array.from({ length: FOOD_ITEM_CAP - 1 }, (_, i) => existingFood({ id: String(i) }))
    expect(() => assertFoodImportWithinCap(existing, 2)).toThrow(/limit/i)
  })
})

describe('importFoodItems', () => {
  beforeEach(() => {
    mockState.inserted = null
    mockState.table = null
    mockState.error = null
  })

  it('inserts rows with user_id and sort_order appended after existing foods', async () => {
    const existing = [existingFood({ sort_order: 4 }), existingFood({ sort_order: 9 })]
    const result = await importFoodItems('user-1', [input('A'), input('B')], existing)
    expect(mockState.table).toBe('food_items')
    expect(result).toEqual({ newCount: 2 })
    expect(mockState.inserted).toEqual([
      expect.objectContaining({ name: 'A', user_id: 'user-1', sort_order: 10 }),
      expect.objectContaining({ name: 'B', user_id: 'user-1', sort_order: 11 }),
    ])
  })

  it('enforces the cap before inserting (no write when over cap)', async () => {
    const existing = Array.from({ length: FOOD_ITEM_CAP }, (_, i) => existingFood({ id: String(i) }))
    await expect(importFoodItems('user-1', [input('A')], existing)).rejects.toThrow(/limit/i)
    expect(mockState.inserted).toBeNull()
  })

  it('throws when the insert returns an error', async () => {
    mockState.error = { message: 'boom' }
    await expect(importFoodItems('user-1', [input('A')], [])).rejects.toThrow('boom')
  })
})
