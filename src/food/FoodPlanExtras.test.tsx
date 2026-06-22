// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FoodPlanExtras from './FoodPlanExtras'
import type { FoodItem, FoodPlanEntry } from '../lib/types'

afterEach(cleanup)

const ts = '2026-06-16T00:00:00.000Z'

const food: FoodItem = {
  id: 'food1',
  user_id: 'user1',
  name: 'Spare bar',
  brand: null,
  serving_description: null,
  serving_weight_grams: 50,
  calories_per_serving: 200,
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
  created_at: ts,
  updated_at: ts,
}

const entry: FoodPlanEntry = {
  id: 'entry1',
  user_id: 'user1',
  food_plan_id: 'plan1',
  day_meal_id: null,
  is_extra: true,
  food_item_id: 'food1',
  basis: 'servings',
  amount: 1,
  sort_order: 0,
  created_at: ts,
  updated_at: ts,
}

describe('FoodPlanExtras', () => {
  it('explains extras when empty', () => {
    render(
      <FoodPlanExtras
        embedded
        extras={[]}
        foodById={new Map()}
        onAddFood={vi.fn()}
      />,
    )

    expect(screen.getByText('Extras')).toBeInTheDocument()
    expect(screen.getByText('Extra or emergency food - counted in packed food, not assigned to a day.')).toBeInTheDocument()
    expect(screen.getByText('No extra food yet. Use Extras for spare meals, emergency bars, or food that is packed but not assigned to a specific day.')).toBeInTheDocument()
  })

  it('renders entries and add action when embedded in the plan document', () => {
    const onAddFood = vi.fn()
    render(
      <FoodPlanExtras
        embedded
        extras={[entry]}
        foodById={new Map([['food1', food]])}
        onAddFood={onAddFood}
      />,
    )

    expect(screen.getByTestId('food-extras')).toBeInTheDocument()
    expect(screen.getByText('Extra or emergency food - counted in packed food, not assigned to a day.')).toBeInTheDocument()
    expect(screen.getByText('Spare bar')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add food' }))

    expect(onAddFood).toHaveBeenCalledTimes(1)
  })
})
