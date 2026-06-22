// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import MealSection from './MealSection'
import type { CellView } from './useFoodPlanDocument'
import type { FoodItem, FoodPlanEntry } from '../lib/types'

// Stub the data-bound entry list so this unit test exercises only the meal
// divider chrome (label grammar, count, calorie total, add control, kebab).
vi.mock('./CellEntryReorder', () => ({
  default: () => <div data-testid="cell-entry-reorder" />,
}))

afterEach(cleanup)

const ts = '2026-06-16T00:00:00.000Z'

const food: FoodItem = {
  id: 'f1', user_id: 'user1', name: 'Oats', brand: null, serving_description: null,
  serving_weight_grams: 50, calories_per_serving: 100, servings_per_package: null,
  fat_grams: null, saturated_fat_grams: null, carbs_grams: null, fiber_grams: null,
  sugar_grams: null, protein_grams: null, sodium_mg: null, potassium_mg: null,
  notes: null, sort_order: 0, created_at: ts, updated_at: ts,
}

function ent(id: string, amount: number): FoodPlanEntry {
  return {
    id, user_id: 'user1', food_plan_id: 'plan1', day_meal_id: 'dm1', is_extra: false,
    food_item_id: 'f1', basis: 'servings', amount, sort_order: 0, created_at: ts, updated_at: ts,
  }
}

function cell(entries: FoodPlanEntry[] = []): CellView {
  return {
    dayMealId: 'dm1',
    meal: {
      id: 'meal1', user_id: 'user1', food_plan_id: 'plan1', name: 'Breakfast',
      anchor_role: 'breakfast', is_default: true, sort_order: 0, created_at: ts, updated_at: ts,
    },
    entries,
  }
}

function renderSection(props: Partial<Parameters<typeof MealSection>[0]> = {}, c: CellView = cell()) {
  render(
    <MealSection
      cell={c}
      listId="list1"
      userId="user1"
      foodById={new Map([['f1', food]])}
      {...props}
    />,
  )
}

describe('MealSection', () => {
  it('renders the meal name as an uppercase eyebrow on the gray-50 divider strip', () => {
    renderSection()

    // The meal name reads as a small uppercase/tracked eyebrow divider, and the
    // divider adopts the prototype's gray-50 section strip (distinguished from
    // the day header by typography, not background).
    expect(screen.getByText('Breakfast')).toHaveClass('uppercase')
    expect(screen.getByTestId('meal-section-header')).toHaveClass('bg-gray-50')
  })

  it('shows the entry count and meal calorie total when the meal has food', () => {
    renderSection({}, cell([ent('e1', 1), ent('e2', 2)]))
    const header = screen.getByTestId('meal-section-header')

    // 2 entries; (1 + 2) servings x 100 kcal = 300 kcal meal total.
    expect(within(header).getByText('2')).toBeInTheDocument()
    expect(within(header).getByText('300 kcal')).toBeInTheDocument()
  })

  it('marks an empty meal quietly without a calorie total', () => {
    renderSection({}, cell([]))
    const header = screen.getByTestId('meal-section-header')

    expect(within(header).getByText('empty')).toBeInTheDocument()
    expect(within(header).queryByText(/kcal/)).not.toBeInTheDocument()
  })

  it('opens the food picker for this meal from the divider add control', () => {
    const onAddFood = vi.fn()
    renderSection({ onAddFood })

    fireEvent.click(screen.getByRole('button', { name: 'Add food' }))

    expect(onAddFood).toHaveBeenCalledTimes(1)
  })

  it('omits the meal on this day from the kebab', () => {
    const onOmit = vi.fn()
    renderSection({ onOmit })

    fireEvent.click(screen.getByRole('button', { name: 'Meal options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Omit on this day' }))

    expect(onOmit).toHaveBeenCalledTimes(1)
  })

  it('deletes the meal everywhere from the kebab', () => {
    const onDeleteMeal = vi.fn()
    renderSection({ onDeleteMeal })

    fireEvent.click(screen.getByRole('button', { name: 'Meal options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete meal everywhere' }))

    expect(onDeleteMeal).toHaveBeenCalledTimes(1)
  })
})
