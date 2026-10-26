// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ListItemWithGear } from '../lib/types'
import ItemRow from './ItemRow'
import SortableItemRow from './SortableItemRow'
import { expectNameCanShrink } from '../test/row-shrink'

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

  it('offers no Delete from inventory in the row menu', async () => {
    // The list view shows "this item is on this trip"; deleting the gear
    // item destroys it in EVERY list, and that entry sat one row under the
    // near-identical, harmless "Remove from list" (UX audits 2026-10).
    // Deleting gear happens on the Gear page. Status shortcuts stay: they
    // are harmless and used mid-planning.
    render(
      <ItemRow
        item={item}
        weightUnit="g"
        isBelowLg={false}
        onDelete={vi.fn()}
        onEditGearItem={vi.fn()}
        onSetGearStatus={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Item options' }))
    expect(screen.getByText('Remove from list')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Needs repair')).toBeInTheDocument()
    expect(screen.queryByText('Delete from inventory')).toBeNull()
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

  // Fixing a weight is the edit you actually want mid-pack, and it works here
  // for a structural reason: the weight cell is OUTSIDE the wrapping label, so
  // an input in it cannot steal the toggle-packed gesture. Name and
  // description are inside that label and stay in the dialog.
  it('edits the weight in place when a save handler is supplied', async () => {
    const onSaveWeight = vi.fn()
    const user = userEvent.setup()
    render(
      <ItemRow
        item={item}
        weightUnit="g"
        isBelowLg={false}
        packMode
        onSaveWeight={onSaveWeight}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit weight 1200 g for Backpack' }))
    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '950')
    // Enter, not Tab: WeightInput contains its own g/oz toggle button, so Tab
    // moves focus WITHIN the component and its onBlur deliberately does not
    // fire. Enter is the commit path a keyboard user actually takes.
    await user.keyboard('{Enter}')

    expect(onSaveWeight).toHaveBeenCalledWith(950)
  })

  it('does not toggle packed when the weight is clicked', async () => {
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    render(
      <ItemRow
        item={item}
        weightUnit="g"
        isBelowLg={false}
        packMode
        onUpdate={onUpdate}
        onSaveWeight={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit weight 1200 g for Backpack' }))

    expect(onUpdate).not.toHaveBeenCalled()
  })

  // The share view passes no handler. A static weight there must stay static.
  it('leaves the weight static when no save handler is supplied', () => {
    render(<ItemRow item={item} weightUnit="g" isBelowLg={false} packMode />)

    expect(screen.queryByRole('button', { name: /Edit weight/ })).toBeNull()
  })
})

describe('SortableItemRow activator', () => {
  it.each([false, true])('renders a named, focusable handle when isBelowLg=%s', (isBelowLg) => {
    render(<SortableItemRow item={item} weightUnit="g" isBelowLg={isBelowLg} />)

    const handle = screen.getByRole('button', { name: 'Reorder Backpack' })
    expect(handle).toHaveAttribute('tabindex', '0')
  })
})

// On a phone a long name must truncate, not push the weight off the row.
// The read-only branch is the share page's.
describe('ItemRow mobile name', () => {
  it.each([
    ['owner, swipe to remove', { onDelete: () => {} }],
    ['read-only share', {}],
  ])('can shrink: %s', (_label, extra) => {
    const { container } = render(
      <ItemRow item={item} weightUnit="g" isBelowLg {...extra} />,
    )
    expectNameCanShrink(screen.getByText('Backpack'), container.firstElementChild as HTMLElement)
  })
})
