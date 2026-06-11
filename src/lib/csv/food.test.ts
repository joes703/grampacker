import { describe, it, expect } from 'vitest'
import { foodItemsToCsv } from './food'
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

describe('foodItemsToCsv', () => {
  it('includes a header row and one row per food', () => {
    const csv = foodItemsToCsv([food({ name: 'Oats', calories_per_serving: 150 })])
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Food Name')
    expect(lines[1]).toContain('Oats')
    expect(lines[1]).toContain('150')
  })

  it('renders missing optional values as empty cells, never zero', () => {
    const csv = foodItemsToCsv([food({ name: 'Plain', protein_grams: null })])
    const cells = (csv.trim().split('\r\n')[1] ?? '').split(',')
    // Column order: 0 name, 3 weight, 4 calories, 11 protein.
    expect(cells[0]).toBe('Plain')
    expect(cells[3]).toBe('50')
    expect(cells[4]).toBe('100')
    expect(cells[11]).toBe('') // protein unknown -> empty, not 0
  })

  it('returns an empty string for an empty library', () => {
    expect(foodItemsToCsv([])).toBe('')
  })
})
