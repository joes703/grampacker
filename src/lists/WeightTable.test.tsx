// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import WeightTable from './WeightTable'
import type { Category, ListItemWithGear } from '../lib/types'
import type { WeightBreakdown } from '../lib/weight-breakdown'

afterEach(cleanup)

// The pure breakdown math lives in lib/weight-breakdown.test.ts. This file
// covers the WeightTable COMPONENT: which rows it renders, when it collapses
// optional rows, and that an explicitly provided breakdown wins over the items.
// Assertions are behavior-level (row text / gram values), not Tailwind classes.

function listItem(o: {
  id: string
  category_id: string | null
  weight_grams: number
  quantity?: number
  is_worn?: boolean
  is_consumable?: boolean
}): ListItemWithGear {
  return {
    id: o.id,
    list_id: 'l-1',
    user_id: 'u',
    gear_item_id: `g-${o.id}`,
    quantity: o.quantity ?? 1,
    is_worn: o.is_worn ?? false,
    is_consumable: o.is_consumable ?? false,
    is_packed: false,
    is_ready: false,
    sort_order: 0,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    gear_item: {
      id: `g-${o.id}`,
      name: `gear-${o.id}`,
      description: null,
      weight_grams: o.weight_grams,
      category_id: o.category_id,
      status: 'active',
    },
  }
}

const shelter: Category = {
  id: 'cat-shelter', user_id: 'u', name: 'Shelter', sort_order: 0, is_default: true, created_at: '2024-01-01',
}

function rowFor(label: string): HTMLElement {
  // The <td> label lives in a <tr>; return the row so we can scope value lookups.
  const cell = screen.getByText(label)
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${label}`)
  return row
}

describe('WeightTable', () => {
  it('renders a category row plus the base and total footer for a simple base item', () => {
    render(<WeightTable items={[listItem({ id: '1', category_id: shelter.id, weight_grams: 250 })]} categories={[shelter]} />)

    // Category row carries its name and gram weight.
    expect(within(rowFor('Shelter')).getByText('250 g')).toBeInTheDocument()
    // Footer totals are always present.
    expect(within(rowFor('Base weight')).getByText('250 g')).toBeInTheDocument()
    expect(within(rowFor('Total pack weight')).getByText('250 g')).toBeInTheDocument()
    // No consumables / worn items -> those optional rows collapse out.
    expect(screen.queryByText('Consumables')).not.toBeInTheDocument()
    expect(screen.queryByText(/Worn/)).not.toBeInTheDocument()
  })

  it('shows the Consumables and Worn rows only when those weights are present', () => {
    render(
      <WeightTable
        items={[
          listItem({ id: '1', category_id: shelter.id, weight_grams: 100 }),
          listItem({ id: '2', category_id: shelter.id, weight_grams: 50, is_consumable: true }),
          listItem({ id: '3', category_id: shelter.id, weight_grams: 30, is_worn: true }),
        ]}
        categories={[shelter]}
      />,
    )

    expect(within(rowFor('Consumables')).getByText('50 g')).toBeInTheDocument()
    expect(within(rowFor('Worn (not added)')).getByText('30 g')).toBeInTheDocument()
    // Worn weight is excluded from pack weight; base + consumables = 150.
    expect(within(rowFor('Base weight')).getByText('100 g')).toBeInTheDocument()
    expect(within(rowFor('Total pack weight')).getByText('150 g')).toBeInTheDocument()
  })

  it('renders nothing for an empty list with no projected weight', () => {
    const { container } = render(<WeightTable items={[]} categories={[shelter]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('uses an explicitly provided breakdown over the items (the share-page path)', () => {
    // SharePage passes a precomputed breakdown (with projected food folded in).
    // The component must render that, not recompute from `items`.
    const breakdown: WeightBreakdown = {
      catRows: [{ id: shelter.id, name: 'Shelter', grams: 200 }],
      baseGrams: 200, consumableGrams: 500, wornGrams: 0, totalPackGrams: 700,
    }
    render(<WeightTable items={[]} categories={[shelter]} breakdown={breakdown} />)

    expect(within(rowFor('Consumables')).getByText('500 g')).toBeInTheDocument()
    expect(within(rowFor('Total pack weight')).getByText('700 g')).toBeInTheDocument()
  })
})
