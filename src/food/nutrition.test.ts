import { describe, it, expect } from 'vitest'
import {
  NUTRIENT_KEYS,
  calorieDensityPerGram,
  carbProteinRatio,
  fatPct,
  nutrientTotal,
  nutrientTotals,
  sugarPct,
  totalWeight,
  type NutrientKey,
} from './nutrition'
import { evaluateTarget } from './targets'
import type { FoodItem } from '../lib/types'

function food(p: Partial<FoodItem> & Pick<FoodItem, 'id'>): FoodItem {
  return {
    name: 'F',
    brand: null,
    servingDescription: null,
    servingWeightGrams: 50,
    caloriesPerServing: 100,
    servingsPerPackage: 4,
    fatGrams: null,
    saturatedFatGrams: null,
    carbsGrams: null,
    fiberGrams: null,
    sugarGrams: null,
    proteinGrams: null,
    sodiumMg: null,
    potassiumMg: null,
    notes: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...p,
  }
}
type NutEntry = { foodItemId: string; basis: 'servings' | 'packages' | 'weight'; amount: number }
function entry(p: Partial<NutEntry>): NutEntry {
  return { foodItemId: 'f', basis: 'servings', amount: 1, ...p }
}
const foodsOf = (...items: FoodItem[]) => new Map(items.map((f) => [f.id, f]))

describe('nutrientTotal', () => {
  it('sums calories scaled by effective servings', () => {
    const foods = foodsOf(food({ id: 'a', caloriesPerServing: 100 }))
    expect(nutrientTotal([entry({ foodItemId: 'a', amount: 2 })], foods, 'calories'))
      .toEqual({ state: 'complete', value: 200 })
  })
  it('weight basis derives servings as amount / servingWeightGrams', () => {
    const foods = foodsOf(food({ id: 'a', servingWeightGrams: 50, caloriesPerServing: 100 }))
    // 100 g at 50 g/serving = 2 servings = 200 kcal
    expect(nutrientTotal([entry({ foodItemId: 'a', basis: 'weight', amount: 100 })], foods, 'calories'))
      .toEqual({ state: 'complete', value: 200 })
  })
  it('packages basis multiplies by servingsPerPackage', () => {
    const foods = foodsOf(food({ id: 'a', servingsPerPackage: 4, caloriesPerServing: 100 }))
    expect(nutrientTotal([entry({ foodItemId: 'a', basis: 'packages', amount: 2 })], foods, 'calories'))
      .toEqual({ state: 'complete', value: 800 })
  })
  it('is incomplete (not zero) when a contributing food lacks the nutrient', () => {
    const foods = foodsOf(
      food({ id: 'a', proteinGrams: 20 }),
      food({ id: 'b', proteinGrams: null }),
    )
    const entries = [entry({ foodItemId: 'a' }), entry({ foodItemId: 'b' })]
    expect(nutrientTotal(entries, foods, 'proteinGrams'))
      .toEqual({ state: 'incomplete', missingFoodIds: ['b'] })
  })
  it('a packages entry with null servingsPerPackage is incomplete even when the nutrient is set', () => {
    // The Codex MAJOR 4 chain, first link: servings are underivable, so the
    // populated calorie column must NOT silently contribute.
    const foods = foodsOf(food({ id: 'a', servingsPerPackage: null, caloriesPerServing: 100 }))
    expect(nutrientTotal([entry({ foodItemId: 'a', basis: 'packages', amount: 2 })], foods, 'calories'))
      .toEqual({ state: 'incomplete', missingFoodIds: ['a'] })
  })
  it('dedupes missing food ids', () => {
    const foods = foodsOf(food({ id: 'b', sodiumMg: null }))
    const entries = [entry({ foodItemId: 'b' }), entry({ foodItemId: 'b' })]
    expect(nutrientTotal(entries, foods, 'sodiumMg'))
      .toEqual({ state: 'incomplete', missingFoodIds: ['b'] })
  })
  it('treats a food absent from the map as incomplete', () => {
    expect(nutrientTotal([entry({ foodItemId: 'missing' })], new Map(), 'calories'))
      .toEqual({ state: 'incomplete', missingFoodIds: ['missing'] })
  })
  it('empty entries -> complete zero', () => {
    expect(nutrientTotal([], new Map(), 'calories')).toEqual({ state: 'complete', value: 0 })
  })
})

describe('totalWeight', () => {
  it('sums effective servings times serving weight, unrounded', () => {
    const foods = foodsOf(food({ id: 'a', servingWeightGrams: 50 }))
    expect(totalWeight([entry({ foodItemId: 'a', amount: 3 })], foods))
      .toEqual({ state: 'complete', grams: 150 })
  })
  it('is incomplete (never silently low) when a food is missing', () => {
    const foods = foodsOf(food({ id: 'a', servingWeightGrams: 50 }))
    const entries = [entry({ foodItemId: 'a' }), entry({ foodItemId: 'gone' })]
    expect(totalWeight(entries, foods))
      .toEqual({ state: 'incomplete', missingFoodIds: ['gone'] })
  })
  it('is incomplete for a packages entry with null servingsPerPackage', () => {
    const foods = foodsOf(food({ id: 'a', servingsPerPackage: null }))
    expect(totalWeight([entry({ foodItemId: 'a', basis: 'packages', amount: 1 })], foods))
      .toEqual({ state: 'incomplete', missingFoodIds: ['a'] })
  })
})

describe('nutrientTotals', () => {
  it('returns one NutrientTotal per key', () => {
    const foods = foodsOf(food({ id: 'a' }))
    const r = nutrientTotals([entry({ foodItemId: 'a' })], foods)
    expect(Object.keys(r).sort()).toEqual([...NUTRIENT_KEYS].sort())
    expect(r.calories).toEqual({ state: 'complete', value: 100 })
  })
})

const C = (value: number) => ({ state: 'complete' as const, value })
const INC = (...ids: string[]) => ({ state: 'incomplete' as const, missingFoodIds: ids })

describe('derived values (canonical)', () => {
  it('calorieDensityPerGram is kcal per gram', () => {
    expect(calorieDensityPerGram(C(200), { state: 'complete', grams: 100 })).toBeCloseTo(2, 5)
  })
  it('calorieDensityPerGram is null at zero or incomplete inputs', () => {
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
    // fat 10, carbs 20, protein 10 -> macroCal = 90 + 80 + 40 = 210; fatCal = 90
    expect(fatPct(C(10), C(20), C(10))).toBeCloseTo(42.857, 2)
    expect(fatPct(C(10), INC('x'), C(10))).toBeNull()
    expect(fatPct(C(0), C(0), C(0))).toBeNull() // zero macro calories
  })
  it('sugarPct uses sugar*4 over the macro-calorie denominator', () => {
    // sugar 25, fat 10, carbs 40, protein 10 -> macroCal = 290; sugarCal = 100
    expect(sugarPct(C(25), C(10), C(40), C(10))).toBeCloseTo(34.483, 2)
    expect(sugarPct(INC('x'), C(10), C(40), C(10))).toBeNull()
    expect(sugarPct(C(25), C(10), INC('x'), C(10))).toBeNull()
  })
})

describe('density uses UNROUNDED grams', () => {
  it('a rounding of the weight would flip the target verdict; the unrounded value must win', () => {
    // 200 kcal over 99.6 g -> 2.008 kcal/g. Rounding 99.6 up to 100 g would
    // read 2.000 and PASS a max-2.0 target; the true value is OVER.
    const foods = foodsOf(food({ id: 'a' }))
    const entries = [entry({ foodItemId: 'a', basis: 'weight', amount: 99.6 }), entry({ foodItemId: 'a', basis: 'weight', amount: 0 })]
    const weight = totalWeight(entries, foods)
    const calories = nutrientTotal([entry({ foodItemId: 'a', amount: 2 })], foods, 'calories')
    const density = calorieDensityPerGram(calories, weight)
    expect(density).toBeCloseTo(200 / 99.6, 6)
    expect(
      evaluateTarget({ mode: 'max', targetMin: null, targetMax: 2 }, density, true),
    ).toBe('over')
  })
})

describe('the packages/null-servingsPerPackage chain (Codex MAJOR 4)', () => {
  it('nutrients incomplete -> weight incomplete -> density null -> target status incomplete', () => {
    const foods = foodsOf(food({ id: 'a', servingsPerPackage: null, caloriesPerServing: 500 }))
    const entries = [entry({ foodItemId: 'a', basis: 'packages', amount: 1 })]
    const calories = nutrientTotal(entries, foods, 'calories')
    const weight = totalWeight(entries, foods)
    expect(calories).toEqual({ state: 'incomplete', missingFoodIds: ['a'] })
    expect(weight).toEqual({ state: 'incomplete', missingFoodIds: ['a'] })
    const density = calorieDensityPerGram(calories, weight)
    expect(density).toBeNull()
    expect(
      evaluateTarget({ mode: 'range', targetMin: 1, targetMax: 2 }, density, true),
    ).toBe('incomplete')
  })
})

describe('NutrientKey coverage', () => {
  it('every FoodItem nutrient column is reachable', () => {
    const f = food({
      id: 'a',
      fatGrams: 1,
      saturatedFatGrams: 2,
      carbsGrams: 3,
      fiberGrams: 4,
      sugarGrams: 5,
      proteinGrams: 6,
      sodiumMg: 7,
      potassiumMg: 8,
    })
    const foods = foodsOf(f)
    const expected: Record<NutrientKey, number> = {
      calories: 100,
      fatGrams: 1,
      saturatedFatGrams: 2,
      carbsGrams: 3,
      fiberGrams: 4,
      sugarGrams: 5,
      proteinGrams: 6,
      sodiumMg: 7,
      potassiumMg: 8,
    }
    for (const key of NUTRIENT_KEYS) {
      expect(nutrientTotal([entry({ foodItemId: 'a' })], foods, key))
        .toEqual({ state: 'complete', value: expected[key] })
    }
  })
})
