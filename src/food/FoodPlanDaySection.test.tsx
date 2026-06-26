// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FoodPlanDaySection from './FoodPlanDaySection'
import type { DayView } from '../lib/food/view'
import type { FoodItem, FoodPlanEntry } from '../lib/types'

vi.mock('./MealSection', () => ({
  default: function MealSectionStub({ cell }: { cell: { meal: { name: string } } }) {
    return <div>{cell.meal.name} meal body</div>
  },
}))

afterEach(cleanup)

const ts = '2026-06-16T00:00:00.000Z'

function dayView(dayType: 'full' | 'partial', override: 'full' | 'partial' | null): DayView {
  return {
    day: {
      id: 'day1',
      user_id: 'user1',
      food_plan_id: 'plan1',
      day_type_override: override,
      sort_order: 0,
      created_at: ts,
      updated_at: ts,
    },
    dayType,
    cells: [],
    scheduledMealIds: new Set(),
  }
}

function dayViewWithMeal(): DayView {
  return {
    ...dayView('full', null),
    cells: [{
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
    }],
    scheduledMealIds: new Set(['meal1']),
  }
}

const lunchMeal = {
  id: 'meal2',
  user_id: 'user1',
  food_plan_id: 'plan1',
  name: 'Lunch',
  anchor_role: null,
  is_default: false,
  sort_order: 1,
  created_at: ts,
  updated_at: ts,
} as const

const food: FoodItem = {
  id: 'f1', user_id: 'user1', name: 'Oats', brand: null, serving_description: null,
  serving_weight_grams: 50, calories_per_serving: 100, servings_per_package: null,
  fat_grams: null, saturated_fat_grams: null, carbs_grams: null, fiber_grams: null,
  sugar_grams: null, protein_grams: null, sodium_mg: null, potassium_mg: null,
  notes: null, sort_order: 0, created_at: ts, updated_at: ts,
}

function dayViewWithFood(): DayView {
  const entry: FoodPlanEntry = {
    id: 'e1', user_id: 'user1', food_plan_id: 'plan1', day_meal_id: 'dm1', is_extra: false,
    food_item_id: 'f1', basis: 'servings', amount: 2, sort_order: 0, created_at: ts, updated_at: ts,
  }
  const base = dayViewWithMeal()
  return { ...base, cells: [{ ...base.cells[0]!, entries: [entry] }] }
}

function renderSection(view: DayView, props: Partial<Parameters<typeof FoodPlanDaySection>[0]> = {}) {
  render(
    <FoodPlanDaySection
      dayView={view}
      dayIndex={0}
      listId="list1"
      userId="user1"
      foodById={new Map()}
      {...props}
    />,
  )
}

describe('FoodPlanDaySection', () => {
  it('renders the day header as a flat gray section strip', () => {
    renderSection(dayViewWithMeal())
    expect(screen.getByTestId('food-day-header-day1')).toHaveClass('bg-gray-50')
  })

  it('shows day calories then weight in the header (weight to the right)', () => {
    renderSection(dayViewWithFood(), { foodById: new Map([['f1', food]]) })
    const header = screen.getByTestId('food-day-header-day1')

    // 2 servings x 100 kcal = 200 kcal; 2 x 50 g = 100 g.
    const cal = within(header).getByText('200 kcal')
    const weight = within(header).getByText('100 g')
    expect(cal).toBeInTheDocument()
    expect(weight).toBeInTheDocument()
    expect(cal.compareDocumentPosition(weight) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('explains that automatic days are derived from the scheduled meals', () => {
    renderSection(dayView('partial', null))

    const label = screen.getByRole('button', {
      name: 'partial - Partial day - excluded from the full-day average and target check. Set automatically from the scheduled meals.',
    })
    expect(label).toHaveTextContent('partial')
    expect(screen.queryByText('(manual)')).not.toBeInTheDocument()

    fireEvent.click(label)
    expect(screen.getByRole('note')).toHaveTextContent('Set automatically from the scheduled meals.')
  })

  it('shows when a partial day was set manually', () => {
    renderSection(dayView('partial', 'partial'))

    const label = screen.getByRole('button', {
      name: 'partial (manual) - Partial day - excluded from the full-day average and target check. Set manually.',
    })
    expect(label).toHaveTextContent('partial')
    expect(screen.getByText('(manual)')).toBeInTheDocument()
  })

  it('shows when a full day was set manually', () => {
    renderSection(dayView('full', 'full'))

    const label = screen.getByRole('button', {
      name: 'full (manual) - Full day - included in the full-day average and target check. Set manually.',
    })
    expect(label).toHaveTextContent('full')
    expect(screen.getByText('(manual)')).toBeInTheDocument()
  })

  it('starts expanded and can collapse the day body', () => {
    renderSection(dayViewWithMeal())

    expect(screen.getByText('Breakfast meal body')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Day 1' }))

    expect(screen.queryByText('Breakfast meal body')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand Day 1' })).toBeInTheDocument()
  })

  it('expands again after collapsing', () => {
    renderSection(dayViewWithMeal())

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Day 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand Day 1' }))

    expect(screen.getByText('Breakfast meal body')).toBeInTheDocument()
  })

  it('opens a keyboard and touch accessible explanation for day type', () => {
    renderSection(dayView('partial', 'partial'))

    fireEvent.click(screen.getByRole('button', {
      name: 'partial (manual) - Partial day - excluded from the full-day average and target check. Set manually.',
    }))

    expect(screen.getByRole('note')).toHaveTextContent(
      'Partial day - excluded from the full-day average and target check. Set manually.',
    )
  })

  it('calls onReviewNutrition from the day header action', () => {
    const onReviewNutrition = vi.fn()
    renderSection(dayViewWithMeal(), { onReviewNutrition })

    fireEvent.click(screen.getByRole('button', { name: 'Review Day 1 nutrition' }))

    expect(onReviewNutrition).toHaveBeenCalledTimes(1)
  })

  it('drops the day-footer macro strip but keeps the header Review affordance', () => {
    renderSection(dayViewWithFood(), { foodById: new Map([['f1', food]]), onReviewNutrition: vi.fn() })

    // The header keeps the compact Review button...
    expect(screen.getByRole('button', { name: 'Review Day 1 nutrition' })).toBeInTheDocument()
    // ...but the repeated day-footer macro strip is gone. Its "P" / "C" / "F"
    // eyebrow labels were unique to that strip (the header labels only
    // Cal/Weight), so their absence proves the strip no longer renders.
    expect(screen.queryByText('P')).not.toBeInTheDocument()
    expect(screen.queryByText('C')).not.toBeInTheDocument()
    expect(screen.queryByText('F')).not.toBeInTheDocument()
  })

  it('keeps collapse and restore behavior when embedded in the plan document', () => {
    const onRestoreMeal = vi.fn()
    renderSection(dayViewWithMeal(), {
      embedded: true,
      allMeals: [dayViewWithMeal().cells[0]!.meal, lunchMeal],
      onRestoreMeal,
    })

    expect(screen.getByTestId('food-day-day1')).toBeInTheDocument()
    expect(screen.getByText('Breakfast meal body')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Day 1' }))
    expect(screen.queryByText('Breakfast meal body')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand Day 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore Lunch' }))

    expect(onRestoreMeal).toHaveBeenCalledWith('day1', 'meal2')
  })

  it('captions the restore pills when a day has omitted meals', () => {
    const onRestoreMeal = vi.fn()
    renderSection(dayViewWithMeal(), {
      embedded: true,
      allMeals: [dayViewWithMeal().cells[0]!.meal, lunchMeal],
      onRestoreMeal,
    })

    expect(screen.getByText('You removed on Day 1 - tap to add back:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore Lunch' })).toBeInTheDocument()
  })

  it('shows no restore caption or pills when every meal is scheduled', () => {
    const onRestoreMeal = vi.fn()
    // allMeals contains only the already-scheduled Breakfast, so nothing is omitted.
    renderSection(dayViewWithMeal(), {
      embedded: true,
      allMeals: [dayViewWithMeal().cells[0]!.meal],
      onRestoreMeal,
    })

    expect(screen.queryByText(/tap to add back/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument()
  })
})
