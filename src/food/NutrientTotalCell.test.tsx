// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NutrientTotalCell from './NutrientTotalCell'

describe('NutrientTotalCell', () => {
  it('renders a formatted complete value with unit', () => {
    render(<NutrientTotalCell total={{ state: 'complete', value: 240.6 }} kind="calories" />)
    expect(screen.getByText('241 kcal')).toBeInTheDocument()
  })
  it('renders grams to one decimal', () => {
    render(<NutrientTotalCell total={{ state: 'complete', value: 12.34 }} kind="grams" />)
    expect(screen.getByText('12.3 g')).toBeInTheDocument()
  })
  it('hides the food names until the marker is tapped, then shows them', async () => {
    const user = userEvent.setup()
    render(
      <NutrientTotalCell
        total={{ state: 'incomplete', missingFoodIds: ['a', 'b'] }}
        kind="grams"
        nameForId={(id) => (id === 'a' ? 'Oats' : 'Nuts')}
      />,
    )
    expect(screen.queryByText('NaN')).not.toBeInTheDocument()
    expect(screen.queryByText('Oats')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /2 foods missing this nutrient/i }))
    expect(screen.getByText('Oats')).toBeVisible()
    expect(screen.getByText('Nuts')).toBeVisible()
  })
})
