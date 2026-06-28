import { describe, it, expect } from 'vitest'
import { projectFoodPlan, totalProjectedConsumableGrams, type ProjectionEntry } from './projection'
import { totalWeight } from './nutrition'
import type { FoodItem } from '../types'

// projection.ts and nutrition.ts each compute grams-from-basis with a different
// algorithm: projection.ts computes grams directly per basis to match the SQL
// and avoid divide-then-multiply, while nutrition.ts (via effectiveServings)
// uses effectiveServings * serving_weight_grams. The architecture review flagged
// these as two coexisting algorithms and asked for a cross-checking invariant
// test rather than collapsing them. This proves they agree on grams for the
// servings, packages, and weight bases.

function food(over: Partial<FoodItem> & { id: string }): FoodItem {
  return {
    user_id: 'u',
    name: `food-${over.id}`,
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
    ...over,
  }
}

// ProjectionEntry and NutEntry are now the same Pick<FoodPlanEntry, ...> shape,
// so one entry array feeds both algorithms.
function projectionGrams(entries: ProjectionEntry[], foods: Map<string, FoodItem>): number {
  return totalProjectedConsumableGrams(projectFoodPlan(entries, foods))
}
function nutritionGrams(entries: ProjectionEntry[], foods: Map<string, FoodItem>): number {
  const w = totalWeight(entries, foods)
  if (w.state !== 'complete') throw new Error('expected a complete weight total')
  return w.grams
}

const oats = food({ id: 'o', serving_weight_grams: 50, servings_per_package: 4 })
const foods = new Map<string, FoodItem>([['o', oats]])

describe('projection vs nutrition grams invariant', () => {
  it('agree for the servings basis', () => {
    const entries: ProjectionEntry[] = [{ food_item_id: 'o', basis: 'servings', amount: 3 }]
    expect(projectionGrams(entries, foods)).toBe(nutritionGrams(entries, foods))
    expect(projectionGrams(entries, foods)).toBe(150) // 3 servings * 50 g
  })

  it('agree for the packages basis', () => {
    const entries: ProjectionEntry[] = [{ food_item_id: 'o', basis: 'packages', amount: 2 }]
    expect(projectionGrams(entries, foods)).toBe(nutritionGrams(entries, foods))
    expect(projectionGrams(entries, foods)).toBe(400) // 2 packages * 4 servings * 50 g
  })

  it('agree for the weight basis (grams are the amount, no round-trip)', () => {
    const entries: ProjectionEntry[] = [{ food_item_id: 'o', basis: 'weight', amount: 175 }]
    expect(projectionGrams(entries, foods)).toBe(nutritionGrams(entries, foods))
    expect(projectionGrams(entries, foods)).toBe(175)
  })

  it('agree (to float precision) for a weight amount that does not divide evenly', () => {
    // amount/sw*sw drifts in nutrition.ts (100/30*30 = 99.99999999999999) while
    // projection.ts keeps grams = 100 exactly. They still agree within float
    // epsilon; this is the divergence the review said to test, not merge.
    const entries: ProjectionEntry[] = [{ food_item_id: 'o', basis: 'weight', amount: 100 }]
    expect(projectionGrams(entries, foods)).toBeCloseTo(nutritionGrams(entries, foods), 9)
  })

  it('agree for a mixed set across all three bases', () => {
    const entries: ProjectionEntry[] = [
      { food_item_id: 'o', basis: 'servings', amount: 3 },
      { food_item_id: 'o', basis: 'packages', amount: 2 },
      { food_item_id: 'o', basis: 'weight', amount: 175 },
    ]
    expect(projectionGrams(entries, foods)).toBe(nutritionGrams(entries, foods))
    expect(projectionGrams(entries, foods)).toBe(725) // 150 + 400 + 175
  })
})
