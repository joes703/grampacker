// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
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
  it('renders as a mobile bottom sheet while keeping the desktop sticky panel classes', () => {
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

    const review = screen.getByLabelText('Day 1 nutrition review panel')
    expect(review).toHaveClass('fixed', 'inset-x-0', 'bottom-0', 'z-50', 'rounded-t-2xl')
    expect(review).toHaveClass('lg:sticky', 'lg:top-3', 'lg:z-auto', 'lg:rounded-lg')
  })

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
    // The calorie daily target shows its band inline on the metric row, but as a
    // neutral reference on a partial day: no over/under mark on that row.
    const calRow = screen.getByRole('row', { name: /Calories/ })
    expect(calRow).toHaveTextContent('<= 300 kcal')
    expect(within(calRow).queryByText('over target')).toBeNull()
    expect(within(calRow).queryByText('under target')).toBeNull()
    // The meal target is still graded.
    expect(screen.getByRole('button', { name: /Dinner/ })).toHaveTextContent('over target')
  })

  it('lays daily targets out as an aligned table, not a flex row (alignment regression)', () => {
    render(
      <DayNutritionReview
        dayView={dayView}
        dayIndex={0}
        foodById={new Map([['food1', food]])}
        dailyTargets={dailyTargets}
        mealTargets={[]}
        onClose={() => {}}
      />,
    )

    // Real column headers, one row per metric: the previous layout stamped the
    // flex-based FLAT_TABLE_HEADER onto a <tr>, which broke column alignment.
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(expect.arrayContaining(['Metric', 'Day total', 'Target']))
    expect(screen.getByRole('row', { name: /Calories/ })).toHaveTextContent('<= 300 kcal')
    // No table row may carry the flex utility (the regressed alignment bug).
    for (const row of screen.getAllByRole('row')) {
      expect(row.className).not.toMatch(/\bflex\b/)
    }
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

    // Calories standardize on "kcal" with no redundant "Cal" label in the
    // breakdown; the value carries the unit.
    expect(screen.queryByText('Cal')).not.toBeInTheDocument()
    expect(screen.getAllByText('400 kcal').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sodium').length).toBeGreaterThan(0)
    expect(screen.getAllByText('800 mg').length).toBeGreaterThan(1)
  })

  it('shows every configured meal target in the expanded meal review', async () => {
    const user = userEvent.setup()
    render(
      <DayNutritionReview
        dayView={dayView}
        dayIndex={0}
        foodById={new Map([['food1', food]])}
        dailyTargets={[]}
        mealTargets={[
          {
            id: 'meal-protein-target',
            user_id: 'user1',
            food_plan_id: 'plan1',
            meal_id: 'meal1',
            metric: 'protein',
            mode: 'min',
            target_min: 8,
            target_max: null,
          },
          {
            id: 'meal-fat-target',
            user_id: 'user1',
            food_plan_id: 'plan1',
            meal_id: 'meal1',
            metric: 'fat_pct',
            mode: 'max',
            target_min: null,
            target_max: 30,
          },
        ]}
        onClose={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Dinner/ }))

    expect(screen.getByRole('button', { name: /Dinner/ })).toHaveTextContent('2 targets')
    expect(screen.getByRole('button', { name: /Dinner/ })).toHaveTextContent('1 over')
    const targetsTable = screen.getByRole('table', { name: 'Dinner targets' })
    expect(within(targetsTable).getByRole('row', { name: /Protein/ })).toHaveTextContent('10.0 g')
    expect(within(targetsTable).getByRole('row', { name: /Protein/ })).toHaveTextContent('>= 8 g')
    expect(within(targetsTable).getByRole('row', { name: /Protein/ })).toHaveTextContent('meets target')
    expect(within(targetsTable).getByRole('row', { name: /Fat%/ })).toHaveTextContent('47.4%')
    expect(within(targetsTable).getByRole('row', { name: /Fat%/ })).toHaveTextContent('<= 30%')
    expect(within(targetsTable).getByRole('row', { name: /Fat%/ })).toHaveTextContent('over target')
  })
})
