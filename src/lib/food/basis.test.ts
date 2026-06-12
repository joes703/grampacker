import { describe, it, expect } from 'vitest'
import { effectiveServings, buildFoodPlanStructure } from './basis'
import type { FoodItem } from '../types'

function food(p: Partial<FoodItem>): FoodItem {
  return {
    id: 'f', user_id: 'u', name: 'F', brand: null, serving_description: null,
    serving_weight_grams: 50, calories_per_serving: 100, servings_per_package: 4,
    fat_grams: null, saturated_fat_grams: null, carbs_grams: null, fiber_grams: null,
    sugar_grams: null, protein_grams: null, sodium_mg: null, potassium_mg: null,
    notes: null, sort_order: 0, created_at: '', updated_at: '', ...p,
  }
}

describe('effectiveServings', () => {
  it('servings returns the amount', () => { expect(effectiveServings({ basis: 'servings', amount: 3 }, food({}))).toBe(3) })
  it('packages multiplies by servings_per_package', () => { expect(effectiveServings({ basis: 'packages', amount: 2 }, food({ servings_per_package: 4 }))).toBe(8) })
  it('weight divides by serving_weight_grams', () => { expect(effectiveServings({ basis: 'weight', amount: 150 }, food({ serving_weight_grams: 50 }))).toBe(3) })
  it('THROWS for packages with no servings_per_package', () => { expect(() => effectiveServings({ basis: 'packages', amount: 2 }, food({ servings_per_package: null }))).toThrow(/servings_per_package/) })
  it('THROWS for weight with non-positive serving weight', () => { expect(() => effectiveServings({ basis: 'weight', amount: 2 }, food({ serving_weight_grams: 0 }))).toThrow(/serving_weight_grams/) })
})

describe('buildFoodPlanStructure', () => {
  it('day count is independent of nights: 5 days -> 5 days, 15 cells (full seed)', () => {
    const s = buildFoodPlanStructure(5, () => crypto.randomUUID())
    expect(s.meals).toHaveLength(3)
    expect(s.meals.filter((m) => m.is_default)).toHaveLength(3)
    expect(s.meals.filter((m) => m.anchor_role !== null)).toHaveLength(2)
    expect(s.days).toHaveLength(5)
    expect(s.dayMeals).toHaveLength(15)
  })
  it('zero days -> no days, empty grid', () => {
    const s = buildFoodPlanStructure(0, () => crypto.randomUUID())
    expect(s.days).toHaveLength(0)
    expect(s.dayMeals).toHaveLength(0)
  })
})
