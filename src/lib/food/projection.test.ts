import { describe, it, expect } from 'vitest'
import { projectFoodPlan, totalProjectedConsumableGrams } from './projection'
import type { FoodItem } from '../types'

const oats = { id: 'o', serving_weight_grams: 50, servings_per_package: 4 } as FoodItem
const bar = { id: 'b', serving_weight_grams: 40, servings_per_package: null } as FoodItem
const noSpp = { id: 'n', serving_weight_grams: 30, servings_per_package: null } as FoodItem
const foods = new Map<string, FoodItem>([['o', oats], ['b', bar], ['n', noSpp]])

describe('projectFoodPlan', () => {
  it('aggregates one complete row per food across all entries', () => {
    const rows = projectFoodPlan([
      { food_item_id: 'o', basis: 'servings', amount: 2 },
      { food_item_id: 'o', basis: 'packages', amount: 1 },
      { food_item_id: 'b', basis: 'weight', amount: 100 },
    ], foods)
    const o = rows.find((r) => r.foodItemId === 'o')!
    expect(o.state).toBe('complete')
    if (o.state === 'complete') {
      expect(o.totalEffectiveServings).toBeCloseTo(6)
      expect(o.totalPackedWeightGrams).toBeCloseTo(300)
    }
    const b = rows.find((r) => r.foodItemId === 'b')!
    expect(b.state).toBe('complete')
    if (b.state === 'complete') expect(b.totalPackedWeightGrams).toBeCloseTo(100)
  })

  it('marks a row incomplete (missing-food) without a zero weight', () => {
    const rows = projectFoodPlan([{ food_item_id: 'gone', basis: 'servings', amount: 1 }], foods)
    expect(rows[0]!.state).toBe('incomplete')
    if (rows[0]!.state === 'incomplete') expect(rows[0]!.reason).toBe('missing-food')
    expect('totalPackedWeightGrams' in rows[0]!).toBe(false)
  })

  it('marks a row incomplete (missing-metadata) when a packages entry lacks servings_per_package', () => {
    const rows = projectFoodPlan([
      { food_item_id: 'n', basis: 'servings', amount: 1 }, // valid
      { food_item_id: 'n', basis: 'packages', amount: 1 }, // invalid: no spp
    ], foods)
    expect(rows[0]!.state).toBe('incomplete')
    if (rows[0]!.state === 'incomplete') expect(rows[0]!.reason).toBe('missing-metadata')
  })

  it('keeps first-appearance order', () => {
    const ids = projectFoodPlan([
      { food_item_id: 'b', basis: 'weight', amount: 40 },
      { food_item_id: 'o', basis: 'servings', amount: 1 },
    ], foods).map((r) => r.foodItemId)
    expect(ids).toEqual(['b', 'o'])
  })

  it('totalProjectedConsumableGrams sums complete rows only', () => {
    const rows = projectFoodPlan([
      { food_item_id: 'o', basis: 'servings', amount: 2 }, // 100 g
      { food_item_id: 'n', basis: 'packages', amount: 1 }, // incomplete -> excluded
    ], foods)
    expect(totalProjectedConsumableGrams(rows)).toBeCloseTo(100)
  })
})
