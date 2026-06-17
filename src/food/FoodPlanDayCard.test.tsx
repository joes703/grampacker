// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FoodPlanDayCard from './FoodPlanDayCard'
import type { DayView } from '../lib/food/view'

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

function renderCard(view: DayView, props: Partial<Parameters<typeof FoodPlanDayCard>[0]> = {}) {
  render(
    <FoodPlanDayCard
      dayView={view}
      dayIndex={0}
      listId="list1"
      userId="user1"
      foodById={new Map()}
      {...props}
    />,
  )
}

describe('FoodPlanDayCard', () => {
  it('explains that automatic days are derived from the scheduled meals', () => {
    renderCard(dayView('partial', null))

    const label = screen.getByRole('button', {
      name: 'partial - Partial day - excluded from the full-day average and target check. Set automatically from the scheduled meals.',
    })
    expect(label).toHaveTextContent('partial')
    expect(screen.queryByText('(manual)')).not.toBeInTheDocument()

    fireEvent.click(label)
    expect(screen.getByRole('note')).toHaveTextContent('Set automatically from the scheduled meals.')
  })

  it('shows when a partial day was set manually', () => {
    renderCard(dayView('partial', 'partial'))

    const label = screen.getByRole('button', {
      name: 'partial (manual) - Partial day - excluded from the full-day average and target check. Set manually.',
    })
    expect(label).toHaveTextContent('partial')
    expect(screen.getByText('(manual)')).toBeInTheDocument()
  })

  it('shows when a full day was set manually', () => {
    renderCard(dayView('full', 'full'))

    const label = screen.getByRole('button', {
      name: 'full (manual) - Full day - included in the full-day average and target check. Set manually.',
    })
    expect(label).toHaveTextContent('full')
    expect(screen.getByText('(manual)')).toBeInTheDocument()
  })

  it('starts expanded and can collapse the day body', () => {
    renderCard(dayViewWithMeal())

    expect(screen.getByText('Breakfast meal body')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Day 1' }))

    expect(screen.queryByText('Breakfast meal body')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand Day 1' })).toBeInTheDocument()
  })

  it('expands again after collapsing', () => {
    renderCard(dayViewWithMeal())

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Day 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand Day 1' }))

    expect(screen.getByText('Breakfast meal body')).toBeInTheDocument()
  })

  it('opens a keyboard and touch accessible explanation for day type', () => {
    renderCard(dayView('partial', 'partial'))

    fireEvent.click(screen.getByRole('button', {
      name: 'partial (manual) - Partial day - excluded from the full-day average and target check. Set manually.',
    }))

    expect(screen.getByRole('note')).toHaveTextContent(
      'Partial day - excluded from the full-day average and target check. Set manually.',
    )
  })

  it('calls onReviewNutrition from the day header action', () => {
    const onReviewNutrition = vi.fn()
    renderCard(dayViewWithMeal(), { onReviewNutrition })

    fireEvent.click(screen.getByRole('button', { name: 'Review Day 1 nutrition' }))

    expect(onReviewNutrition).toHaveBeenCalledTimes(1)
  })

  it('keeps collapse and restore behavior when embedded in the plan document', () => {
    const onRestoreMeal = vi.fn()
    renderCard(dayViewWithMeal(), {
      embedded: true,
      allMeals: [dayViewWithMeal().cells[0]!.meal, lunchMeal],
      onRestoreMeal,
    })

    expect(screen.getByTestId('food-day-day1')).toBeInTheDocument()
    expect(screen.getByText('Breakfast meal body')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Day 1' }))
    expect(screen.queryByText('Breakfast meal body')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand Day 1' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Restore Lunch' }))

    expect(onRestoreMeal).toHaveBeenCalledWith('day1', 'meal2')
  })
})
