// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DayNutritionReview from './DayNutritionReview'
import type { DayView } from '../lib/food/view'
import type { FoodItem, FoodPlanDailyTarget, FoodPlanEntry, MealTarget } from '../lib/types'

vi.mock('../lib/use-weight-unit', () => ({
  useWeightUnit: () => ({ weightUnit: 'g' }),
}))

afterEach(cleanup)

const ts = '2026-06-16T00:00:00.000Z'

const food: FoodItem = {
  id: 'food1',
  user_id: 'user1',
  name: 'Peanut noodles',
  brand: null,
  serving_description: '1 meal',
  serving_weight_grams: 100,
  calories_per_serving: 400,
  servings_per_package: null,
  fat_grams: 20,
  saturated_fat_grams: null,
  carbs_grams: 40,
  fiber_grams: 5,
  sugar_grams: 10,
  protein_grams: 10,
  sodium_mg: 800,
  potassium_mg: null,
  notes: null,
  sort_order: 0,
  created_at: ts,
  updated_at: ts,
}

const entry: FoodPlanEntry = {
  id: 'entry1',
  user_id: 'user1',
  food_plan_id: 'plan1',
  day_meal_id: 'dm1',
  is_extra: false,
  food_item_id: 'food1',
  basis: 'servings',
  amount: 1,
  sort_order: 0,
  created_at: ts,
  updated_at: ts,
}

const dayView: DayView = {
  day: {
    id: 'day1',
    user_id: 'user1',
    food_plan_id: 'plan1',
    day_type_override: null,
    sort_order: 0,
    created_at: ts,
    updated_at: ts,
  },
  dayType: 'partial',
  scheduledMealIds: new Set(['meal1']),
  cells: [{
    dayMealId: 'dm1',
    meal: {
      id: 'meal1',
      user_id: 'user1',
      food_plan_id: 'plan1',
      name: 'Dinner',
      anchor_role: 'dinner',
      is_default: true,
      sort_order: 0,
      created_at: ts,
      updated_at: ts,
    },
    entries: [entry],
  }],
}

const dailyTargets: FoodPlanDailyTarget[] = [{
  id: 'target1',
  user_id: 'user1',
  food_plan_id: 'plan1',
  metric: 'calories',
  mode: 'max',
  target_min: null,
  target_max: 300,
}]

const mealTargets: MealTarget[] = [{
  id: 'meal-target1',
  user_id: 'user1',
  food_plan_id: 'plan1',
  meal_id: 'meal1',
  metric: 'fat_pct',
  mode: 'max',
  target_min: null,
  target_max: 30,
}]

describe('DayNutritionReview', () => {
  it('shows partial-day daily targets as reference while still grading meal targets', () => {
    render(
      <DayNutritionReview
        dayView={dayView}
        dayIndex={0}
        foodById={new Map([['food1', food]])}
        dailyTargets={dailyTargets}
        mealTargets={mealTargets}
        onClose={() => {}}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Day 1 nutrition review' })).toBeInTheDocument()
    expect(screen.getByText(/Partial day/)).toBeInTheDocument()
    expect(screen.getByText(/Daily targets are shown as neutral reference/)).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Daily target/ })).toHaveTextContent('<= 300 kcal')
    expect(screen.getByRole('button', { name: /Dinner/ })).toHaveTextContent('over target')
    expect(screen.getAllByText('over target')).toHaveLength(1)
  })

  it('expands a meal to show its nutrient breakdown', async () => {
    const user = userEvent.setup()
    render(
      <DayNutritionReview
        dayView={dayView}
        dayIndex={0}
        foodById={new Map([['food1', food]])}
        dailyTargets={[]}
        mealTargets={[]}
        onClose={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Dinner/ }))

    expect(screen.getByText('Cal')).toBeInTheDocument()
    expect(screen.getAllByText('400 kcal').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sodium').length).toBeGreaterThan(0)
    expect(screen.getAllByText('800 mg').length).toBeGreaterThan(1)
  })
})
