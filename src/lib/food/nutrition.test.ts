import { describe, it, expect } from 'vitest'
import { nutrientTotal, nutrientTotals, totalWeight, NUTRIENT_KEYS } from './nutrition'
import type { FoodItem, FoodPlanEntry } from '../types'

function food(p: Partial<FoodItem>): FoodItem {
  return {
    id: 'f', user_id: 'u', name: 'F', brand: null, serving_description: null,
    serving_weight_grams: 50, calories_per_serving: 100, servings_per_package: 4,
    fat_grams: null, saturated_fat_grams: null, carbs_grams: null, fiber_grams: null,
    sugar_grams: null, protein_grams: null, sodium_mg: null, potassium_mg: null,
    notes: null, sort_order: 0, created_at: '', updated_at: '', ...p,
  }
}
function entry(p: Partial<FoodPlanEntry>): FoodPlanEntry {
  return {
    id: 'e', user_id: 'u', food_plan_id: 'p', day_meal_id: 'dm', is_extra: false,
    food_item_id: 'f', basis: 'servings', amount: 1, sort_order: 0, created_at: '', updated_at: '', ...p,
  }
}

describe('nutrientTotal', () => {
  it('sums calories scaled by effective servings', () => {
    const foods = new Map([['a', food({ id: 'a', calories_per_serving: 100 })]])
    expect(nutrientTotal([entry({ food_item_id: 'a', amount: 2 })], foods, 'calories'))
      .toEqual({ state: 'complete', value: 200 })
  })
  it('is incomplete (not zero) when a contributing food lacks the nutrient', () => {
    const foods = new Map([
      ['a', food({ id: 'a', protein_grams: 20 })],
      ['b', food({ id: 'b', protein_grams: null })],
    ])
    const entries = [entry({ food_item_id: 'a' }), entry({ id: 'e2', food_item_id: 'b' })]
    expect(nutrientTotal(entries, foods, 'protein_grams'))
      .toEqual({ state: 'incomplete', missingFoodIds: ['b'] })
  })
  it('dedupes missing food ids', () => {
    const foods = new Map([['b', food({ id: 'b', sodium_mg: null })]])
    const entries = [entry({ food_item_id: 'b' }), entry({ id: 'e2', food_item_id: 'b' })]
    expect(nutrientTotal(entries, foods, 'sodium_mg'))
      .toEqual({ state: 'incomplete', missingFoodIds: ['b'] })
  })
  it('treats a food absent from the map as incomplete', () => {
    expect(nutrientTotal([entry({ food_item_id: 'missing' })], new Map(), 'calories'))
      .toEqual({ state: 'incomplete', missingFoodIds: ['missing'] })
  })
  it('empty entries -> complete zero', () => {
    expect(nutrientTotal([], new Map(), 'calories')).toEqual({ state: 'complete', value: 0 })
  })
})

describe('totalWeight', () => {
  it('sums effective servings times serving weight', () => {
    const foods = new Map([['a', food({ id: 'a', serving_weight_grams: 50 })]])
    expect(totalWeight([entry({ food_item_id: 'a', amount: 3 })], foods))
      .toEqual({ state: 'complete', grams: 150 })
  })
  it('is incomplete (never silently low) when a food is missing', () => {
    const foods = new Map([['a', food({ id: 'a', serving_weight_grams: 50 })]])
    const entries = [entry({ food_item_id: 'a', amount: 1 }), entry({ id: 'e2', food_item_id: 'gone' })]
    expect(totalWeight(entries, foods))
      .toEqual({ state: 'incomplete', missingFoodIds: ['gone'] })
  })
})

describe('nutrientTotals', () => {
  it('returns one NutrientTotal per key', () => {
    const foods = new Map([['a', food({ id: 'a' })]])
    const r = nutrientTotals([entry({ food_item_id: 'a' })], foods)
    expect(Object.keys(r).sort()).toEqual([...NUTRIENT_KEYS].sort())
    expect(r.calories).toEqual({ state: 'complete', value: 100 })
  })
})

import { calorieDensityPerGram, carbProteinRatio, fatPct, sugarPct, sodiumDensity } from './nutrition'

const C = (value: number) => ({ state: 'complete' as const, value })
const INC = (...ids: string[]) => ({ state: 'incomplete' as const, missingFoodIds: ids })

describe('derived values (canonical)', () => {
  it('calorieDensityPerGram is kcal per gram', () => {
    expect(calorieDensityPerGram(C(200), { state: 'complete', grams: 100 })).toBeCloseTo(2, 5)
  })
  it('calorieDensityPerGram is null at zero or incomplete weight', () => {
    expect(calorieDensityPerGram(C(200), { state: 'complete', grams: 0 })).toBeNull()
    expect(calorieDensityPerGram(C(200), { state: 'incomplete', missingFoodIds: ['x'] })).toBeNull()
    expect(calorieDensityPerGram(INC('x'), { state: 'complete', grams: 100 })).toBeNull()
  })
  it('carbProteinRatio needs both complete and protein > 0', () => {
    expect(carbProteinRatio(C(60), C(20))).toBeCloseTo(3, 5)
    expect(carbProteinRatio(C(60), C(0))).toBeNull()
    expect(carbProteinRatio(INC('x'), C(20))).toBeNull()
  })
  it('fatPct uses the calculated macro-calorie denominator', () => {
    // fat 10, carbs 20, protein 10 -> macroCal = 90 + 80 + 40 = 210; fatCal = 90; 90/210*100 = 42.857
    expect(fatPct(C(10), C(20), C(10))).toBeCloseTo(42.857, 2)
    expect(fatPct(C(10), INC('x'), C(10))).toBeNull() // denominator needs carbs complete
  })
  it('sugarPct uses sugar*4 over the macro-calorie denominator', () => {
    // sugar 25, fat 10, carbs 40, protein 10 -> macroCal = 90 + 160 + 40 = 290; sugarCal = 100; 100/290*100 = 34.48
    expect(sugarPct(C(25), C(10), C(40), C(10))).toBeCloseTo(34.483, 2)
    expect(sugarPct(INC('x'), C(10), C(40), C(10))).toBeNull() // sugar (numerator) unknown
    expect(sugarPct(C(25), C(10), INC('x'), C(10))).toBeNull() // denominator unknown -> sugar % unknown
  })
  it('sodiumDensity is mg per kcal', () => {
    expect(sodiumDensity(C(400), C(2000))).toBeCloseTo(0.2, 5)
    expect(sodiumDensity(C(400), C(0))).toBeNull()
  })
})
