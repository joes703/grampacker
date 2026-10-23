// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import WeightTable from './WeightTable'
import { computeListWeightBreakdown } from '../lib/weight-breakdown'
import type { Category, ListItemWithGear } from '../lib/types'

afterEach(cleanup)

// The pure breakdown math lives in lib/weight-breakdown.test.ts. This file
// covers the WeightTable COMPONENT: which rows it renders, when it collapses
// optional rows, and that an explicitly provided breakdown wins over the items.
// Assertions are behavior-level (row text / gram values), not Tailwind classes.

function listItem(o: {
  id: string
  categoryId: string | null
  weightGrams: number
  quantity?: number
  isWorn?: boolean
  isConsumable?: boolean
}): ListItemWithGear {
  return {
    id: o.id,
    listId: 'l-1',
    gearItemId: `g-${o.id}`,
    quantity: o.quantity ?? 1,
    isWorn: o.isWorn ?? false,
    isConsumable: o.isConsumable ?? false,
    isPacked: false,
    isReady: false,
    packingLocationId: null,
    sortOrder: 0,
    packSortOrder: 0,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    gearItem: {
      id: `g-${o.id}`,
      categoryId: o.categoryId,
      name: `gear-${o.id}`,
      description: null,
      weightGrams: o.weightGrams,
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder: 0,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    },
  }
}

const shelter: Category = {
  id: 'cat-shelter', name: 'Shelter', sortOrder: 0, createdAt: '2024-01-01',
}

function rowFor(label: string): HTMLElement {
  // The <td> label lives in a <tr>; return the row so we can scope value lookups.
  const cell = screen.getByText(label)
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${label}`)
  return row
}

// The component no longer computes anything: a breakdown is required and can
// only come from computeListWeightBreakdown. These tests therefore build one
// the same way production does, which is also the only way to state what food
// contributes.
function breakdownFor(items: ListItemWithGear[], categories: Category[], foodGrams = 0) {
  return computeListWeightBreakdown({
    gear: { items, categories },
    food: { grams: foodGrams },
  })
}

describe('WeightTable', () => {
  it('renders a category row plus the base and total footer for a simple base item', () => {
    render(<WeightTable items={[listItem({ id: '1', categoryId: shelter.id, weightGrams: 250 })]} categories={[shelter]} breakdown={breakdownFor([listItem({ id: '1', categoryId: shelter.id, weightGrams: 250 })], [shelter])} />)

    // Category row carries its name and gram weight.
    expect(within(rowFor('Shelter')).getByLabelText('250 g')).toBeInTheDocument()
    // Footer totals are always present.
    expect(within(rowFor('Base weight')).getByLabelText('250 g')).toBeInTheDocument()
    expect(within(rowFor('Total pack weight')).getByLabelText('250 g')).toBeInTheDocument()
    // No consumables / worn items -> those optional rows collapse out.
    expect(screen.queryByText('Consumables')).not.toBeInTheDocument()
    expect(screen.queryByText(/Worn/)).not.toBeInTheDocument()
  })

  it('titles the per-category block so base-only figures read as base, not errors', () => {
    // A category holding consumable or worn gear shows LESS here than its
    // rows sum to, by design (base never includes consumables or worn).
    // Untitled, a correct 70 g beside a 180 g category read as a bug to two
    // UX audits; the heading states what the column is.
    const items = [listItem({ id: '1', categoryId: shelter.id, weightGrams: 250 })]
    render(<WeightTable items={items} categories={[shelter]} breakdown={breakdownFor(items, [shelter])} />)
    expect(screen.getByText('Base weight by category')).toBeInTheDocument()
  })

  it('rounds aggregate gram values to whole grams', () => {
    // Three 100.1 g items sum to a fractional aggregate. The table keeps the
    // underlying breakdown precise but presents its gram column as whole grams.
    render(
      <WeightTable
        items={[
          listItem({ id: '1', categoryId: shelter.id, weightGrams: 100.1 }),
          listItem({ id: '2', categoryId: shelter.id, weightGrams: 100.1 }),
          listItem({ id: '3', categoryId: shelter.id, weightGrams: 100.1 }),
        ]}
        categories={[shelter]}
        breakdown={breakdownFor([
          listItem({ id: '1', categoryId: shelter.id, weightGrams: 100.1 }),
          listItem({ id: '2', categoryId: shelter.id, weightGrams: 100.1 }),
          listItem({ id: '3', categoryId: shelter.id, weightGrams: 100.1 }),
        ], [shelter])}
      />,
    )

    expect(within(rowFor('Shelter')).getByLabelText('300 g')).toBeInTheDocument()
    expect(within(rowFor('Base weight')).getByLabelText('300 g')).toBeInTheDocument()
    expect(within(rowFor('Total pack weight')).getByLabelText('300 g')).toBeInTheDocument()
    expect(screen.queryByLabelText('300.3 g')).not.toBeInTheDocument()
  })

  it('shows the Consumables and Worn rows only when those weights are present', () => {
    render(
      <WeightTable
        items={[
          listItem({ id: '1', categoryId: shelter.id, weightGrams: 100 }),
          listItem({ id: '2', categoryId: shelter.id, weightGrams: 50, isConsumable: true }),
          listItem({ id: '3', categoryId: shelter.id, weightGrams: 30, isWorn: true }),
        ]}
        categories={[shelter]}
        breakdown={breakdownFor([
          listItem({ id: '1', categoryId: shelter.id, weightGrams: 100 }),
          listItem({ id: '2', categoryId: shelter.id, weightGrams: 50, isConsumable: true }),
          listItem({ id: '3', categoryId: shelter.id, weightGrams: 30, isWorn: true }),
        ], [shelter])}
      />,
    )

    expect(within(rowFor('Consumables')).getByLabelText('50 g')).toBeInTheDocument()
    expect(within(rowFor('Worn (not added)')).getByLabelText('30 g')).toBeInTheDocument()
    // Worn weight is excluded from pack weight; base + consumables = 150.
    expect(within(rowFor('Base weight')).getByLabelText('100 g')).toBeInTheDocument()
    expect(within(rowFor('Total pack weight')).getByLabelText('150 g')).toBeInTheDocument()
  })

  it('renders nothing for an empty list with no projected weight', () => {
    const { container } = render(<WeightTable items={[]} categories={[shelter]} breakdown={breakdownFor([], [shelter])} />)
    expect(container).toBeEmptyDOMElement()
  })

  // Replaces a test that asserted a provided breakdown beat the component's
  // own gear-only recomputation. That fallback is gone - a breakdown is now
  // required and branded, so this file can no longer even construct one by
  // hand - and what is actually worth pinning is that food reaches the
  // rendered rows, which is the bug the share shipped with.
  it('renders food into consumables and the total, not into a category row', () => {
    const items = [listItem({ id: '1', categoryId: shelter.id, weightGrams: 200 })]
    render(
      <WeightTable
        items={items}
        categories={[shelter]}
        breakdown={breakdownFor(items, [shelter], 500)}
      />,
    )

    expect(within(rowFor('Consumables')).getByLabelText('500 g')).toBeInTheDocument()
    expect(within(rowFor('Total pack weight')).getByLabelText('700 g')).toBeInTheDocument()
    // Food is not gear: it has no category and must never inflate one, or the
    // per-section subtotals stop summing to the whole.
    expect(within(rowFor('Shelter')).getByLabelText('200 g')).toBeInTheDocument()
  })
})
