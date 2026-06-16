import { describe, it, expect } from 'vitest'
import { buildTakeoutFiles } from './takeout-files'
import type { FoodTakeoutData } from '../queries'
import type { FoodItem, FoodPlan } from '../types'

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

describe('buildTakeoutFiles', () => {
  it('emits food-data.json built via buildFoodDataJson (version 2 + plan arrays)', () => {
    const foodData: FoodTakeoutData = {
      ...EMPTY_FOOD_DATA,
      food_plans: [{ id: 'p1' } as unknown as FoodPlan],
    }
    const files = buildTakeoutFiles({
      categories: [],
      gearItems: [],
      foodItems: [] as FoodItem[],
      foodData,
      lists: [],
      allItems: [],
    })
    expect(files).toHaveProperty('food-data.json')
    const doc = JSON.parse(files['food-data.json']!)
    expect(doc.version).toBe(2)
    expect(doc.food_plans).toEqual([{ id: 'p1' }])
    expect(doc).not.toHaveProperty('food_pack_state')
  })

  it('always includes the gear and food library CSV files', () => {
    const files = buildTakeoutFiles({
      categories: [],
      gearItems: [],
      foodItems: [],
      foodData: EMPTY_FOOD_DATA,
      lists: [],
      allItems: [],
    })
    expect(files).toHaveProperty('gear-library.csv')
    expect(files).toHaveProperty('food-library.csv')
  })
})
