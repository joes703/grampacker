// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import FoodPlanStatStrip from './FoodPlanStatStrip'
import { setWeightUnit } from '../lib/weight'
import { summarizeTrip } from '../lib/food/nutrition'
import type { FoodPlanView } from '../lib/food/view'
import type { FoodItem, Meal } from '../lib/types'

afterEach(cleanup)
afterEach(() => setWeightUnit('g'))

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
const foods = new Map([['a', food({})]])

describe('FoodPlanStatStrip', () => {
  it('shows packed weight, full-day average calories with denominator, and calorie density', () => {
    setWeightUnit('g')
    render(<FoodPlanStatStrip summary={summarizeTrip(view, foods)} foodById={foods} />)

    expect(screen.getByText('Packed food')).toBeInTheDocument()
    // 2 + 1 + 3 servings x 50 g = 300 g packed.
    expect(screen.getByText('300 g')).toBeInTheDocument()

    expect(screen.getByText('Full-day average')).toBeInTheDocument()
    // Only the single full day (200 kcal) counts; the partial day is excluded.
    expect(screen.getByText('200')).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 days counted/i)).toBeInTheDocument()

    expect(screen.getByText('Calorie density')).toBeInTheDocument()
    // 600 packed kcal / 300 g = 2.00 kcal/g.
    expect(screen.getByText('2.00 kcal/g')).toBeInTheDocument()
  })

  it('renders calorie density in the selected weight unit', () => {
    setWeightUnit('oz')
    render(<FoodPlanStatStrip summary={summarizeTrip(view, foods)} foodById={foods} />)
    expect(screen.getByText(/kcal\/oz/)).toBeInTheDocument()
  })

  it('shows the selected unit primary + the alternate unit muted, and swaps on toggle', () => {
    const summary = summarizeTrip(view, foods)

    // g selected: grams primary (gray-900), ounces muted (gray-400); density too.
    setWeightUnit('g')
    const { unmount } = render(<FoodPlanStatStrip summary={summary} foodById={foods} />)
    expect(screen.getByText('300 g')).toHaveClass('text-gray-900')
    expect(screen.getByText('10.6 oz')).toHaveClass('text-gray-400')
    expect(screen.getByText('2.00 kcal/g')).toHaveClass('text-gray-900')
    expect(screen.getByText('56.7 kcal/oz')).toHaveClass('text-gray-400')
    unmount()

    // oz selected: primary/secondary swap.
    setWeightUnit('oz')
    render(<FoodPlanStatStrip summary={summary} foodById={foods} />)
    expect(screen.getByText('10.6 oz')).toHaveClass('text-gray-900')
    expect(screen.getByText('300 g')).toHaveClass('text-gray-400')
    expect(screen.getByText('56.7 kcal/oz')).toHaveClass('text-gray-900')
    expect(screen.getByText('2.00 kcal/g')).toHaveClass('text-gray-400')
  })
})
