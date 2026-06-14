// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MealTargetsBar from './MealTargetsBar'
import type { FoodItem, FoodPlanEntry, MealTarget } from '../lib/types'

afterEach(cleanup)

const food = (o: Partial<FoodItem>): FoodItem => ({
  id: 'f', user_id: 'u', name: 'F', brand: null, serving_description: null, serving_weight_grams: 100,
  calories_per_serving: 100, servings_per_package: null, fat_grams: 10, saturated_fat_grams: null,
  carbs_grams: 20, fiber_grams: null, sugar_grams: 5, protein_grams: 10, sodium_mg: 200, potassium_mg: null,
  notes: null, sort_order: 0, created_at: '', updated_at: '', ...o,
})
const entry = (food_item_id: string): FoodPlanEntry => ({
  id: 'e', user_id: 'u', food_plan_id: 'p', day_meal_id: 'dm', is_extra: false, food_item_id,
  basis: 'servings', amount: 1, sort_order: 0, created_at: '', updated_at: '',
})

describe('MealTargetsBar', () => {
  it('marks a configured target', () => {
    const foods = new Map([['f', food({})]])
    const targets: MealTarget[] = [{ id: 't', user_id: 'u', food_plan_id: 'p', meal_id: 'mm', metric: 'fat_pct', mode: 'max', target_min: null, target_max: 30 }]
    render(<MealTargetsBar entries={[entry('f')]} foodById={foods} mealTargets={targets} />)
    expect(screen.getByText('over target')).toBeInTheDocument()
  })
  it('renders an IncompleteMarker naming the food (not a dash) when an input nutrient is missing', async () => {
    const user = userEvent.setup()
    const foods = new Map([['f', food({ sodium_mg: null })]]) // breaks only Na density -> exactly one marker
    render(<MealTargetsBar entries={[entry('f')]} foodById={foods} mealTargets={[]} />)
    expect(screen.queryByText('-')).not.toBeInTheDocument() // not a silent dash
    await user.click(screen.getByRole('button', { name: /1 food .*missing/i }))
    expect(screen.getByText('F')).toBeVisible() // tooltip names the food
  })
})
