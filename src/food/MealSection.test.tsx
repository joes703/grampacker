// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import MealSection from './MealSection'
import type { CellView } from './useFoodPlanDocument'

// Stub the data-bound children so this unit test exercises only the meal
// header chrome (label grammar + kebab actions), not entry/target rendering.
vi.mock('./CellEntryReorder', () => ({
  default: () => <div data-testid="cell-entry-reorder" />,
}))
vi.mock('./MealTargetsBar', () => ({
  default: () => <div data-testid="meal-targets-bar" />,
}))

afterEach(cleanup)

const ts = '2026-06-16T00:00:00.000Z'

function cell(): CellView {
  return {
    dayMealId: 'dm1',
    meal: {
      id: 'meal1',
      user_id: 'user1',
      food_plan_id: 'plan1',
      name: 'Breakfast',
      anchor_role: 'breakfast',
      is_default: true,
      sort_order: 0,
      created_at: ts,
      updated_at: ts,
    },
    entries: [],
  }
}

function renderSection(props: Partial<Parameters<typeof MealSection>[0]> = {}) {
  render(
    <MealSection
      cell={cell()}
      listId="list1"
      userId="user1"
      foodById={new Map()}
      mealTargets={[]}
      {...props}
    />,
  )
}

describe('MealSection', () => {
  it('renders the meal name as a non-gray uppercase eyebrow sub-divider', () => {
    renderSection()

    // The meal name reads as a small uppercase/tracked eyebrow divider.
    expect(screen.getByText('Breakfast')).toHaveClass('uppercase')
    // The day header owns the gray-50 section-strip grammar; a meal is a
    // lighter, indented sub-divider, so its header must NOT be the gray strip.
    expect(screen.getByTestId('meal-section-header')).not.toHaveClass('bg-gray-50')
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
