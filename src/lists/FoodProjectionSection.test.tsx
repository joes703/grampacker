// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import FoodProjectionSection, { type FoodProjectionDisplayRow } from './FoodProjectionSection'

const rows: FoodProjectionDisplayRow[] = [
  {
    foodItemId: 'bar',
    state: 'complete',
    name: 'Energy bar',
    brand: 'Trail Co',
    servingsLabel: '2 servings',
    weightGrams: 120,
    packed: false,
    packable: true,
  },
  {
    foodItemId: 'oil',
    state: 'complete',
    name: 'Olive oil',
    brand: null,
    servingsLabel: '1.5 servings',
    weightGrams: 60,
    packed: true,
    packable: true,
  },
  {
    foodItemId: 'missing',
    state: 'incomplete',
    name: 'Mystery food',
    brand: null,
    reason: 'missing-metadata',
  },
]

function renderSection(overrides: Partial<React.ComponentProps<typeof FoodProjectionSection>> = {}) {
  const onTogglePacked = vi.fn()
  render(
    <MemoryRouter>
      <FoodProjectionSection
        listId="list-1"
        packMode={false}
        showUnpackedOnly={false}
        rows={rows}
        onTogglePacked={onTogglePacked}
        {...overrides}
      />
    </MemoryRouter>,
  )
  return { onTogglePacked }
}

describe('FoodProjectionSection', () => {
  afterEach(() => cleanup())

  it('renders projected food as read-only rows with incomplete rows called out', () => {
    renderSection()

    expect(screen.getByText('Energy bar')).toBeInTheDocument()
    expect(screen.getByText('Trail Co')).toBeInTheDocument()
    expect(screen.getByText('2 servings')).toBeInTheDocument()
    expect(screen.getByText('Mystery food')).toBeInTheDocument()
    expect(screen.getByText('Missing packaging info')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /edit food plan/i })).toHaveAttribute('href', '/lists/list-1/food')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('renders pack checkboxes in pack mode and delegates toggles', () => {
    const { onTogglePacked } = renderSection({ packMode: true })

    fireEvent.click(screen.getByRole('checkbox', { name: /pack energy bar/i }))

    expect(onTogglePacked).toHaveBeenCalledWith('bar', true)
    expect(screen.getByRole('checkbox', { name: /pack mystery food/i })).toBeDisabled()
  })

  it('keeps incomplete rows visible when showing unpacked only', () => {
    renderSection({ packMode: true, showUnpackedOnly: true })

    expect(screen.getByText('Energy bar')).toBeInTheDocument()
    expect(screen.queryByText('Olive oil')).not.toBeInTheDocument()
    expect(screen.getByText('Mystery food')).toBeInTheDocument()
  })
})
