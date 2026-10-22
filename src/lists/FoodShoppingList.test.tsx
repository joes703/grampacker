// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import FoodShoppingList from './FoodShoppingList'
import type { FoodItemResponse } from '../../shared/food'

afterEach(cleanup)

function makeItem(overrides: Partial<FoodItemResponse> = {}): FoodItemResponse {
  return {
    id: 'food-1',
    name: 'Fruit bar',
    weightGrams: 30,
    quantity: 2,
    isPerMeal: true,
    unitCount: 8,
    sortOrder: 0,
    isPacked: false,
    isReady: false,
    packingLocationId: null,
    packSortOrder: 0,
    slotIds: ['s1', 's2', 's3', 's4'],
    ...overrides,
  }
}

describe('FoodShoppingList', () => {
  it('is a tally: one row per item, name and carried count, nothing else', () => {
    const { container } = render(
      <FoodShoppingList
        items={[
          makeItem(),
          makeItem({ id: 'food-2', name: 'Peanut butter', unitCount: 1, isPerMeal: false }),
        ]}
      />,
    )
    expect(screen.getByText('Fruit bar')).toBeInTheDocument()
    expect(screen.getByText('× 8')).toBeInTheDocument()
    expect(screen.getByText('Peanut butter')).toBeInTheDocument()
    expect(screen.getByText('× 1')).toBeInTheDocument()
    // Read-only by contract: the plan is the only editing surface.
    expect(container.querySelectorAll('button, input, a')).toHaveLength(0)
  })

  it('renders the server-computed unitCount, never local arithmetic', () => {
    // quantity 2 across 4 meals would be 8 if recomputed; the server says 5
    // (it owns the definition - shared/food.ts foodUnitCount). Render what it
    // sent so the tally and the pack can never disagree.
    render(<FoodShoppingList items={[makeItem({ unitCount: 5 })]} />)
    expect(screen.getByText('× 5')).toBeInTheDocument()
  })

  it('says when there is nothing to buy yet', () => {
    render(<FoodShoppingList items={[]} />)
    expect(screen.getByText('Nothing planned yet')).toBeInTheDocument()
  })
})
