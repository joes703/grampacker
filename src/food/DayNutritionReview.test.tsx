// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DayNutritionReview from './DayNutritionReview'
import type { PlanDayView, PlanEntryView } from './plan-view'
import type { FoodItem } from '../lib/types'
import type { FoodPlanDailyTarget, MealTarget } from '../../shared/food-plans'

vi.mock('../lib/use-weight-unit', () => ({
  useWeightUnit: () => ({ weightUnit: 'g' }),
}))

afterEach(cleanup)

const food: FoodItem = {
  id: 'food1',
  name: 'Peanut noodles',
  brand: null,
  servingDescription: '1 meal',
  servingWeightGrams: 100,
  caloriesPerServing: 400,
  servingsPerPackage: null,
  fatGrams: 20,
  saturatedFatGrams: null,
  carbsGrams: 40,
  fiberGrams: 5,
  sugarGrams: 10,
  proteinGrams: 10,
  sodiumMg: 800,
  potassiumMg: null,
  notes: null,
  sortOrder: 0,
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
}

const entry: PlanEntryView = {
  id: 'entry1',
  foodItemId: 'food1',
  food,
  basis: 'servings',
  amount: 1,
  grams: 100,
  incomplete: false,
  sortOrder: 0,
  fullGrams: 100,
}

function day(over: Partial<PlanDayView> = {}): PlanDayView {
  return {
    id: 'day1',
    index: 1,
    dayTypeOverride: null,
    dayType: 'partial',
    cells: [
      {
        dayMealId: 'dm1',
        mealId: 'meal1',
        mealName: 'Dinner',
        anchorRole: 'dinner',
        entries: [entry],
        grams: 100,
        incomplete: false,
      },
    ],
    grams: 100,
    incomplete: false,
    ...over,
  }
}

const dailyTargets: FoodPlanDailyTarget[] = [
  { id: 'target1', metric: 'calories', mode: 'max', targetMin: null, targetMax: 300 },
]

const mealTargets: MealTarget[] = [
  { id: 'meal-target1', mealId: 'meal1', metric: 'fat_pct', mode: 'max', targetMin: null, targetMax: 30 },
]

function renderPanel(over: {
  day?: PlanDayView
  dailyTargets?: FoodPlanDailyTarget[]
  mealTargets?: MealTarget[]
} = {}) {
  return render(
    <DayNutritionReview
      day={over.day ?? day()}
      foodById={new Map([['food1', food]])}
      dailyTargets={over.dailyTargets ?? []}
      mealTargets={over.mealTargets ?? []}
      onClose={() => {}}
    />,
  )
}

describe('DayNutritionReview', () => {
  it('renders as a mobile bottom sheet while keeping the desktop sticky panel classes', () => {
    renderPanel()
    const review = screen.getByLabelText('Day 1 nutrition review panel')
    expect(review).toHaveClass('fixed', 'inset-x-0', 'bottom-0', 'z-50', 'rounded-t-2xl')
    expect(review).toHaveClass('lg:sticky', 'lg:top-3', 'lg:z-auto', 'lg:rounded-lg')
  })

  it('shows partial-day daily targets as reference while still grading meal targets', () => {
    renderPanel({ dailyTargets, mealTargets })

    expect(screen.getByRole('heading', { name: 'Day 1 nutrition review' })).toBeInTheDocument()
    expect(screen.getByText(/Partial day/)).toBeInTheDocument()
    expect(screen.getByText(/Daily targets are shown as neutral reference/)).toBeInTheDocument()
    // The calorie daily target shows its band inline on the metric row, but as
    // a neutral reference on a partial day: no over/under mark on that row.
    const calRow = screen.getByRole('row', { name: /Calories/ })
    expect(calRow).toHaveTextContent('<= 300 kcal')
    expect(within(calRow).queryByText('over target')).toBeNull()
    expect(within(calRow).queryByText('under target')).toBeNull()
    // The meal target is still graded (fat 47.4% > max 30).
    expect(screen.getByRole('button', { name: /Dinner/ })).toHaveTextContent('over target')
  })

  it('grades daily targets on a full day', () => {
    renderPanel({ day: day({ dayType: 'full' }), dailyTargets })
    // 400 kcal against a 300 kcal max -> over.
    const calRow = screen.getByRole('row', { name: /Calories/ })
    expect(within(calRow).getByText('over target')).toBeInTheDocument()
    expect(screen.queryByText(/neutral reference/)).toBeNull()
  })

  it('lays daily targets out as an aligned table, not a flex row (alignment regression)', () => {
    renderPanel({ dailyTargets })

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
    renderPanel()

    await user.click(screen.getByRole('button', { name: /Dinner/ }))

    // Calories standardize on "kcal" with no redundant "Cal" label; the value
    // carries the unit.
    expect(screen.queryByText('Cal')).not.toBeInTheDocument()
    expect(screen.getAllByText('400 kcal').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sodium').length).toBeGreaterThan(0)
    expect(screen.getAllByText('800 mg').length).toBeGreaterThan(0)
  })

  it('shows every configured meal target in the expanded meal review', async () => {
    const user = userEvent.setup()
    renderPanel({
      mealTargets: [
        { id: 'meal-protein-target', mealId: 'meal1', metric: 'protein', mode: 'min', targetMin: 8, targetMax: null },
        { id: 'meal-fat-target', mealId: 'meal1', metric: 'fat_pct', mode: 'max', targetMin: null, targetMax: 30 },
      ],
    })

    await user.click(screen.getByRole('button', { name: /Dinner/ }))

    expect(screen.getByRole('button', { name: /Dinner/ })).toHaveTextContent('2 targets')
    expect(screen.getByRole('button', { name: /Dinner/ })).toHaveTextContent('1 over')
    const targetsTable = screen.getByRole('table', { name: 'Dinner targets' })
    const proteinRow = within(targetsTable).getByRole('row', { name: /Protein/ })
    expect(proteinRow).toHaveTextContent('10.0 g')
    expect(proteinRow).toHaveTextContent('>= 8 g')
    expect(proteinRow).toHaveTextContent('meets target')
    const fatRow = within(targetsTable).getByRole('row', { name: /Fat%/ })
    expect(fatRow).toHaveTextContent('47.4%')
    expect(fatRow).toHaveTextContent('<= 30%')
    expect(fatRow).toHaveTextContent('over target')
  })

  it('marks an incomplete meal as never compared', async () => {
    const user = userEvent.setup()
    // A packages entry with no package size: fat% is unknowable.
    const incompleteEntry: PlanEntryView = { ...entry, basis: 'packages', incomplete: true, grams: 0, fullGrams: 0 }
    renderPanel({
      day: day({
        cells: [
          {
            dayMealId: 'dm1',
            mealId: 'meal1',
            mealName: 'Dinner',
            anchorRole: 'dinner',
            entries: [incompleteEntry],
            grams: 0,
            incomplete: true,
          },
        ],
      }),
      mealTargets,
    })

    await user.click(screen.getByRole('button', { name: /Dinner/ }))
    expect(screen.getByRole('button', { name: /Dinner/ })).toHaveTextContent('1 incomplete')
  })
})
