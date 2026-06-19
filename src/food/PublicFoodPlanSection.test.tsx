// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import PublicFoodPlanSection from './PublicFoodPlanSection'
import type { PublicFoodPlanDocument } from '../lib/types'

afterEach(cleanup)

const baseDoc: PublicFoodPlanDocument = {
  plan: { id: 'plan-1', list_slug: 'shared' },
  meals: [{
    id: 'meal-1',
    name: 'Breakfast',
    anchor_role: 'breakfast',
    is_default: true,
    sort_order: 0,
  }],
  days: [{
    id: 'day-1',
    day_type_override: null,
    sort_order: 0,
  }],
  dayMeals: [{
    id: 'day-meal-1',
    day_id: 'day-1',
    meal_id: 'meal-1',
  }],
  entries: [{
    id: 'entry-1',
    day_meal_id: 'day-meal-1',
    is_extra: false,
    food_item_id: 'food-1',
    basis: 'servings',
    amount: 1,
    sort_order: 0,
  }],
  foods: [{
    id: 'food-1',
    name: 'Oats',
    brand: null,
    serving_description: null,
    serving_weight_grams: 50,
    calories_per_serving: 100,
    servings_per_package: null,
    fat_grams: 3,
    saturated_fat_grams: null,
    carbs_grams: 20,
    fiber_grams: null,
    sugar_grams: null,
    protein_grams: 6,
    sodium_mg: 100,
    potassium_mg: null,
    sort_order: 0,
  }],
  dailyTargets: [],
  mealTargets: [],
}

describe('PublicFoodPlanSection', () => {
  it("labels active daily targets as the list owner's targets", () => {
    render(
      <PublicFoodPlanSection
        doc={{
          ...baseDoc,
          dailyTargets: [{
            id: 'target-1',
            metric: 'calories',
            mode: 'max',
            target_min: null,
            target_max: 3000,
          }],
        }}
      />,
    )

    expect(screen.getByText("Targets shown are the list owner's, not grampacker recommendations.")).toBeInTheDocument()
  })

  it('does not show the owner-target disclaimer when no active targets are set', () => {
    const { rerender } = render(<PublicFoodPlanSection doc={baseDoc} />)

    expect(screen.queryByText(/not grampacker recommendations/i)).not.toBeInTheDocument()

    rerender(
      <PublicFoodPlanSection
        doc={{
          ...baseDoc,
          dailyTargets: [{
            id: 'target-1',
            metric: 'calories',
            mode: 'off',
            target_min: null,
            target_max: null,
          }],
        }}
      />,
    )

    expect(screen.queryByText(/not grampacker recommendations/i)).not.toBeInTheDocument()
  })

  it('renders one continuous flat document shell containing the days and embedded Extras', () => {
    render(<PublicFoodPlanSection doc={baseDoc} />)

    const shell = screen.getByTestId('public-food-plan-document')
    expect(within(shell).getByTestId('public-food-day-day-1')).toBeInTheDocument()
    // Extras renders inside the same shell (embedded FoodPlanExtras), exactly once.
    expect(within(shell).getByTestId('food-extras')).toBeInTheDocument()
    expect(within(shell).getAllByTestId('food-extras')).toHaveLength(1)
  })

  it('uses the flat day-section grammar: gray day-header strip, non-gray uppercase eyebrow meal header', () => {
    render(<PublicFoodPlanSection doc={baseDoc} />)

    expect(screen.getByTestId('public-food-day-header-day-1')).toHaveClass('bg-gray-50')
    const mealHeader = screen.getByTestId('public-food-meal-header')
    expect(mealHeader).not.toHaveClass('bg-gray-50')
    expect(mealHeader).toHaveTextContent('Breakfast')
    // The meal name reads as a small uppercase/tracked eyebrow divider.
    expect(within(mealHeader).getByText('Breakfast')).toHaveClass('uppercase')
  })

  it('shows no private editor controls (stays read-only)', () => {
    render(<PublicFoodPlanSection doc={baseDoc} />)

    expect(screen.queryByRole('button', { name: /review .* nutrition/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Day options' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Meal options' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /drag to reorder/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add food/i })).not.toBeInTheDocument()
  })
})
