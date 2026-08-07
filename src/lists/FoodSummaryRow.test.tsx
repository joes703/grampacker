// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import FoodSummaryRow from './FoodSummaryRow'
import type { ListFoodResponse } from '../../shared/food'

afterEach(cleanup)

const EMPTY: ListFoodResponse = { dayCount: 0, slots: [], items: [] }

function makeFood(over: Partial<ListFoodResponse>): ListFoodResponse {
  return { ...EMPTY, ...over }
}

function renderRow(food: ListFoodResponse) {
  return render(
    <MemoryRouter>
      <FoodSummaryRow listId="list-1" food={food} weightUnit="g" />
    </MemoryRouter>,
  )
}

describe('FoodSummaryRow', () => {
  it('links to the food view', () => {
    renderRow(EMPTY)
    expect(screen.getByRole('link', { name: /food/i })).toHaveAttribute(
      'href',
      '/lists/list-1/food',
    )
  })

  it('shows days and total weight when planned', () => {
    renderRow(
      makeFood({
        dayCount: 3,
        items: [
          { id: 'f1', name: 'Ramen', weightGrams: 85, quantity: 2, sortOrder: 0, slotIds: [] },
        ],
      }),
    )
    expect(screen.getByText('3 days')).toBeInTheDocument()
    // 85 g x 2 carried units = 170 g, via foodGramsFor - never slot-joined
    expect(screen.getByLabelText('170 g')).toBeInTheDocument()
  })

  it('reads none-yet when nothing is planned', () => {
    renderRow(EMPTY)
    expect(screen.getByText('none yet')).toBeInTheDocument()
  })

  it('reads none-yet when days are set but nothing is carried', () => {
    // A three-day grid with zero items is still "nothing planned" weight-wise
    renderRow(makeFood({ dayCount: 3 }))
    expect(screen.getByText('3 days')).toBeInTheDocument()
    expect(screen.getByText('none yet')).toBeInTheDocument()
  })
})
