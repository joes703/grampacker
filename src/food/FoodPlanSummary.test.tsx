// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FoodPlanSummary from './FoodPlanSummary'
import type { FoodPlanView } from '../lib/food/view'
import type { FoodItem, Meal } from '../lib/types'

afterEach(cleanup)

function food(p: Partial<FoodItem>): FoodItem {
  return {
    id: 'a', user_id: 'u', name: 'Oats', brand: null, serving_description: null,
    serving_weight_grams: 50, calories_per_serving: 100, servings_per_package: null,
    fat_grams: 5, saturated_fat_grams: null, carbs_grams: 20, fiber_grams: null,
    sugar_grams: null, protein_grams: 10, sodium_mg: 100, potassium_mg: null,
    notes: null, sort_order: 0, created_at: '', updated_at: '', ...p,
  }
}
const meal: Meal = { id: 'm', user_id: 'u', food_plan_id: 'p', name: 'Breakfast', anchor_role: 'breakfast', is_default: true, sort_order: 0, created_at: '', updated_at: '' }
function ent(id: string, dayMealId: string | null, amount: number, isExtra = false) {
  return { id, user_id: 'u', food_plan_id: 'p', day_meal_id: dayMealId, is_extra: isExtra, food_item_id: 'a', basis: 'servings' as const, amount, sort_order: 0, created_at: '', updated_at: '' }
}
const view: FoodPlanView = {
  meals: [meal],
  days: [
    { day: { id: 'd1', user_id: 'u', food_plan_id: 'p', day_type_override: null, sort_order: 0, created_at: '', updated_at: '' }, dayType: 'full', scheduledMealIds: new Set(['m']), cells: [{ dayMealId: 'dm1', meal, entries: [ent('x', 'dm1', 2)] }] },
    { day: { id: 'd2', user_id: 'u', food_plan_id: 'p', day_type_override: null, sort_order: 1, created_at: '', updated_at: '' }, dayType: 'partial', scheduledMealIds: new Set(['m']), cells: [{ dayMealId: 'dm2', meal, entries: [ent('y', 'dm2', 1)] }] },
  ],
  extras: [ent('z', null, 3, true)],
}

describe('FoodPlanSummary', () => {
  const foods = new Map([['a', food({})]])
  it('Planned total sums numbered days only', () => {
    render(<FoodPlanSummary view={view} foodById={foods} dailyTargets={[]} />)
    const row = screen.getByRole('row', { name: /Planned total/i })
    expect(within(row).getByText('300 kcal')).toBeInTheDocument()
  })
  it('Packed total = Planned + Extras', () => {
    render(<FoodPlanSummary view={view} foodById={foods} dailyTargets={[]} />)
    const row = screen.getByRole('row', { name: /Packed total/i })
    expect(within(row).getByText('600 kcal')).toBeInTheDocument()
  })
  it('states the Full-day average denominator in the headline and the row', () => {
    render(<FoodPlanSummary view={view} foodById={foods} dailyTargets={[]} />)
    expect(screen.getByText(/200 kcal \(1 of 2 days counted\)/i)).toBeInTheDocument()
    expect(screen.getAllByText(/1 of 2 days counted/i).length).toBeGreaterThanOrEqual(2)
  })
  it('reveals optional columns via More metrics', async () => {
    const user = userEvent.setup()
    render(<FoodPlanSummary view={view} foodById={foods} dailyTargets={[]} />)
    expect(screen.queryByRole('columnheader', { name: /Fiber/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /More metrics/i }))
    expect(screen.getByRole('columnheader', { name: /Fiber/i })).toBeInTheDocument()
  })
  it('collapses and reopens the summary table', async () => {
    const user = userEvent.setup()
    render(<FoodPlanSummary view={view} foodById={foods} dailyTargets={[]} />)
    expect(screen.getByRole('row', { name: /Planned total/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Summary' }))
    expect(screen.queryByRole('row', { name: /Planned total/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Summary' }))
    expect(screen.getByRole('row', { name: /Planned total/i })).toBeInTheDocument()
  })
  it('shows the incomplete marker when a contributing food lacks the nutrient', () => {
    const partial = new Map([['a', food({ sodium_mg: null })]])
    render(<FoodPlanSummary view={view} foodById={partial} dailyTargets={[]} />)
    expect(screen.getAllByRole('button', { name: /missing this nutrient/i }).length).toBeGreaterThan(0)
  })
  it('shows a Target band, grades a Full day, leaves a Partial day neutral', () => {
    const dailyTargets = [{ id: 'd1', user_id: 'u', food_plan_id: 'p', metric: 'calories' as const, mode: 'max' as const, target_min: null, target_max: 50 }]
    render(<FoodPlanSummary view={view} foodById={foods} dailyTargets={dailyTargets} />)
    expect(screen.getByRole('row', { name: 'Daily target' })).toBeInTheDocument()
    // Full day exceeds the 50 kcal max -> 'over'; Partial day shows no mark.
    const fullRow = screen.getByRole('row', { name: /Day 1/ })
    expect(within(fullRow).getByText('over target')).toBeInTheDocument()
    const partialRow = screen.getByRole('row', { name: /Day 2/ })
    expect(within(partialRow).queryByText('over target')).not.toBeInTheDocument()
  })
  it('links day and extras rows to their document sections', () => {
    render(<FoodPlanSummary view={view} foodById={foods} dailyTargets={[]} />)

    expect(screen.getByRole('link', { name: /Day 1/i })).toHaveAttribute('href', '#food-day-d1')
    expect(screen.getByRole('link', { name: /Day 2/i })).toHaveAttribute('href', '#food-day-d2')
    expect(screen.getByRole('link', { name: 'Extras' })).toHaveAttribute('href', '#food-extras')
  })
})
