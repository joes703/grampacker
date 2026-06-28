import { describe, it, expect } from 'vitest'
import { projectFoodPlan, totalProjectedConsumableGrams } from './projection'
import type { FoodItem, FoodItemLite } from '../types'

// A real FoodItem factory instead of `{...} as FoodItem`: the cast hid every
// field projectFoodPlan doesn't read, so a future required column on FoodItem
// would silently keep compiling here. The factory fills a complete row and
// only takes the fields each case actually varies.
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
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

const oats = food({ id: 'o', serving_weight_grams: 50, servings_per_package: 4 })
const bar = food({ id: 'b', serving_weight_grams: 40, servings_per_package: null })
const noSpp = food({ id: 'n', serving_weight_grams: 30, servings_per_package: null })
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

  it('projects from lite food rows that carry no nutrient columns', () => {
    // The packing projection feeds projectFoodPlan a FoodItemLite map (6 cols,
    // no nutrient fields). A genuine lite object - not a full FoodItem cast -
    // must type-check and project correctly.
    const lite: FoodItemLite = {
      id: 'bar', name: 'Bar', brand: null,
      serving_weight_grams: 50, calories_per_serving: 200, servings_per_package: 2,
    }
    const liteFoods = new Map<string, FoodItemLite>([['bar', lite]])
    const rows = projectFoodPlan([{ food_item_id: 'bar', basis: 'servings', amount: 3 }], liteFoods)
    expect(rows[0]).toMatchObject({
      state: 'complete', totalEffectiveServings: 3, totalPackedWeightGrams: 150,
    })
    if (rows[0]!.state === 'complete') expect(rows[0]!.food.name).toBe('Bar')
  })
})
