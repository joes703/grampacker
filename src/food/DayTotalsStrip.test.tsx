// @vitest-environment jsdom
import { afterEach, it, expect } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import DayTotalsStrip from './DayTotalsStrip'
import type { DayView } from '../lib/food/view'
import type { FoodItem } from '../lib/types'

afterEach(cleanup)

function food(p: Partial<FoodItem>): FoodItem {
  return {
    id: 'a', user_id: 'u', name: 'Oats', brand: null, serving_description: null,
    serving_weight_grams: 50, calories_per_serving: 100, servings_per_package: null,
    fat_grams: null, saturated_fat_grams: null, carbs_grams: null, fiber_grams: null,
    sugar_grams: null, protein_grams: null, sodium_mg: null, potassium_mg: null,
    notes: null, sort_order: 0, created_at: '', updated_at: '', ...p,
  }
}
const meal = { id: 'm', user_id: 'u', food_plan_id: 'p', name: 'Breakfast', anchor_role: 'breakfast' as const, is_default: true, sort_order: 0, created_at: '', updated_at: '' }
const dayView: DayView = {
  day: { id: 'd1', user_id: 'u', food_plan_id: 'p', day_type_override: null, sort_order: 0, created_at: '', updated_at: '' },
  dayType: 'full',
  scheduledMealIds: new Set(['m']),
  cells: [{ dayMealId: 'dm', meal, entries: [
    { id: 'e', user_id: 'u', food_plan_id: 'p', day_meal_id: 'dm', is_extra: false, food_item_id: 'a', basis: 'servings', amount: 2, sort_order: 0, created_at: '', updated_at: '' },
  ] }],
}

it('shows a compact day header: calories and weight only (macros live in the summary)', () => {
  render(<DayTotalsStrip dayView={dayView} foodById={new Map([['a', food({})]])} />)
  expect(screen.getByText('200 kcal')).toBeInTheDocument() // 2 servings * 100 kcal
  expect(screen.getByText('100 g')).toBeInTheDocument()    // 2 servings * 50 g, default 'g' unit
  expect(screen.queryByText('Carbs')).not.toBeInTheDocument()
  expect(screen.queryByText('Density')).not.toBeInTheDocument()
})
