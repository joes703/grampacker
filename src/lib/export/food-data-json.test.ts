import { describe, it, expect } from 'vitest'
import { buildFoodDataJson } from './food-data-json'
import type { FoodItem } from '../types'
import type { FoodTakeoutData } from '../queries'

const EMPTY_FOOD_DATA: FoodTakeoutData = {
  food_plans: [],
  meals: [],
  food_plan_days: [],
  day_meals: [],
  food_plan_entries: [],
  food_plan_daily_targets: [],
  meal_targets: [],
  food_plan_target_defaults: [],
}

const fakeItem = { id: 'f1' } as unknown as FoodItem

describe('buildFoodDataJson', () => {
  it('stamps version 2 and composes food_items with the food-plan tables', () => {
    const doc = buildFoodDataJson([fakeItem], {
      ...EMPTY_FOOD_DATA,
      food_plans: [{ id: 'p1' } as unknown as FoodTakeoutData['food_plans'][number]],
    })
    expect(doc.version).toBe(2)
    expect(doc.food_items).toEqual([fakeItem])
    expect(doc.food_plans).toEqual([{ id: 'p1' }])
    expect(Object.keys(doc).sort()).toEqual([
      'day_meals',
      'food_items',
      'food_plan_daily_targets',
      'food_plan_days',
      'food_plan_entries',
      'food_plan_target_defaults',
      'food_plans',
      'meal_targets',
      'meals',
      'version',
    ])
  })

  it('never emits a food_pack_state key', () => {
    const doc = buildFoodDataJson([], EMPTY_FOOD_DATA)
    expect(doc).not.toHaveProperty('food_pack_state')
  })
})
