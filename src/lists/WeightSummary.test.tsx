// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import WeightSummary from './WeightSummary'
import { computeListWeightBreakdown } from '../lib/weight-breakdown'
import type { Category, ListItemWithGear } from '../lib/types'

// The compact strip is the only weight surface a phone shows without a tap,
// so what it includes is a product decision: all four buckets, always, so a
// flag toggle never adds a column and shifts the layout under a tap.

function listItem(overrides: {
  id: string
  weightGrams: number
  isWorn?: boolean
  isConsumable?: boolean
}): ListItemWithGear {
  return {
    id: overrides.id,
    listId: 'l-1',
    gearItemId: `g-${overrides.id}`,
    quantity: 1,
    isWorn: overrides.isWorn ?? false,
    isConsumable: overrides.isConsumable ?? false,
    isPacked: false,
    isReady: false,
    packingLocationId: null,
    sortOrder: 0,
    packSortOrder: 0,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    gearItem: {
      id: `g-${overrides.id}`,
      name: `gear-${overrides.id}`,
      description: null,
      weightGrams: overrides.weightGrams,
      categoryId: 'cat-1',
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder: 0,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    },
  }
}

const categories: Category[] = [
  { id: 'cat-1', name: 'Shelter', sortOrder: 0, createdAt: '2024-01-01' },
]

function renderSummary(items: ListItemWithGear[]) {
  const breakdown = computeListWeightBreakdown({
    gear: { items, categories },
    food: { grams: 0 },
  })
  render(<WeightSummary items={items} categories={categories} breakdown={breakdown} />)
}

afterEach(() => cleanup())

describe('WeightSummary compact strip', () => {
  it('shows Base, Worn, Consumable and Pack total with their figures', () => {
    renderSummary([
      listItem({ id: 'tent', weightGrams: 900 }),
      listItem({ id: 'shirt', weightGrams: 150, isWorn: true }),
      listItem({ id: 'gas', weightGrams: 230, isConsumable: true }),
    ])
    const strip = screen.getByText('Pack total').closest('.grid') as HTMLElement
    expect(within(strip).getByText('Base')).toBeInTheDocument()
    expect(within(strip).getByLabelText('900 g')).toBeInTheDocument()
    expect(within(strip).getByText('Worn')).toBeInTheDocument()
    expect(within(strip).getByLabelText('150 g')).toBeInTheDocument()
    expect(within(strip).getByText('Consumable')).toBeInTheDocument()
    expect(within(strip).getByLabelText('230 g')).toBeInTheDocument()
    // Pack total = base + consumable; worn is excluded by the base-weight law.
    expect(within(strip).getByLabelText('1130 g')).toBeInTheDocument()
  })

  it('keeps the Worn stat at 0 rather than dropping the column', () => {
    renderSummary([listItem({ id: 'tent', weightGrams: 900 })])
    const strip = screen.getByText('Pack total').closest('.grid') as HTMLElement
    expect(within(strip).getByText('Worn')).toBeInTheDocument()
    expect(within(strip).getAllByLabelText('0 g').length).toBeGreaterThan(0)
  })
})
