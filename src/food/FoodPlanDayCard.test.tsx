// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import FoodPlanDayCard from './FoodPlanDayCard'
import type { DayView } from '../lib/food/view'

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

function renderCard(view: DayView) {
  render(
    <FoodPlanDayCard
      dayView={view}
      dayIndex={0}
      listId="list1"
      userId="user1"
      foodById={new Map()}
    />,
  )
}

describe('FoodPlanDayCard', () => {
  it('explains automatic partial days', () => {
    renderCard(dayView('partial', null))

    const label = screen.getByTitle('Partial day - excluded from the full-day average and target check.')
    expect(label).toHaveTextContent('partial')
    expect(screen.queryByText('(manual)')).not.toBeInTheDocument()
  })

  it('shows when a partial day was set manually', () => {
    renderCard(dayView('partial', 'partial'))

    const label = screen.getByTitle('Partial day - excluded from the full-day average and target check. Set manually.')
    expect(label).toHaveTextContent('partial')
    expect(screen.getByText('(manual)')).toBeInTheDocument()
  })

  it('shows when a full day was set manually', () => {
    renderCard(dayView('full', 'full'))

    const label = screen.getByTitle('Full day - included in the full-day average and target check. Set manually.')
    expect(label).toHaveTextContent('full')
    expect(screen.getByText('(manual)')).toBeInTheDocument()
  })
})
