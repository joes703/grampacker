// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ListItemWithGear } from '../lib/types'
import ItemRow from './ItemRow'
import SortableItemRow from './SortableItemRow'

afterEach(() => {
  cleanup()
})

const item: ListItemWithGear = {
  id: 'item-1',
  listId: 'list-1',
  gearItemId: 'gear-1',
  quantity: 2,
  isWorn: false,
  isConsumable: false,
  isPacked: false,
  isReady: false,
  packingLocationId: null,
  sortOrder: 0,
  packSortOrder: 0,
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
  gearItem: {
    id: 'gear-1',
    categoryId: 'category-1',
    name: 'Backpack',
    description: 'Main pack',
    weightGrams: 1200,
    cost: null,
    purchaseDate: null,
    status: 'active',
    sortOrder: 0,
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
  },
}

describe('ItemRow', () => {
  it('includes visible mobile row text in the edit button accessible name', () => {
    const onEditGearItem = vi.fn()

    render(
      <ItemRow
        item={item}
        weightUnit="g"
        isBelowLg
        onEditGearItem={onEditGearItem}
      />,
    )

    expect(screen.getByRole('button', { name: 'Edit Backpack, quantity 2, 1200 g' })).toBeInTheDocument()
  })
})

// Pack rows carried no weight at all, which made "adjust a weight while
// packing" a trip to another view. The cell has two hard constraints: it must
// sit OUTSIDE the wrapping label (which is the toggle-packed gesture) and it
// must not reach paper, because the printed checklist keeps its old geometry.
describe('ItemRow pack-mode weight', () => {
  // ItemWeightValue splits the number and its unit into separate spans for
  // column alignment and carries the readable string on an aria-label, so the
  // value is reachable by label rather than by text.
  it('shows the weight on a pack row', () => {
    render(<ItemRow item={item} weightUnit="g" isBelowLg={false} packMode />)

    expect(screen.getByLabelText('1200 g')).toBeInTheDocument()
  })

  it('keeps the weight outside the label that toggles packed', () => {
    render(<ItemRow item={item} weightUnit="g" isBelowLg={false} packMode />)

    expect(screen.getByLabelText('1200 g').closest('label')).toBeNull()
  })

  it('hides the weight in print so the paper checklist is unchanged', () => {
    render(<ItemRow item={item} weightUnit="g" isBelowLg={false} packMode />)

    const cell = screen.getByLabelText('1200 g').parentElement
    expect(cell?.className).toContain('print:hidden')
  })
})

describe('SortableItemRow activator', () => {
  it.each([false, true])('renders a named, focusable handle when isBelowLg=%s', (isBelowLg) => {
    render(<SortableItemRow item={item} weightUnit="g" isBelowLg={isBelowLg} />)

    const handle = screen.getByRole('button', { name: 'Reorder Backpack' })
    expect(handle).toHaveAttribute('tabindex', '0')
  })
})
