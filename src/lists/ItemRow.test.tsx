// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ListItemWithGear } from '../lib/types'
import ItemRow from './ItemRow'
import SortableItemRow from './SortableItemRow'
import PackItemRow from './PackItemRow'
import { expectNameCanShrink } from '../test/row-shrink'
import { buildRowProps } from './section-parts'
import { unconfirmedId } from '../lib/unconfirmed-id'

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
    // near-identical, harmless "Remove from list".
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
describe('PackItemRow weight', () => {
  // ItemWeightValue splits the number and its unit into separate spans for
  // column alignment and carries the readable string on an aria-label, so the
  // value is reachable by label rather than by text.
  it('shows the weight on a pack row', () => {
    render(<PackItemRow item={item} weightUnit="g" />)

    expect(screen.getByLabelText('1200 g')).toBeInTheDocument()
  })

  it('keeps the weight outside the label that toggles packed', () => {
    render(<PackItemRow item={item} weightUnit="g" />)

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
      <PackItemRow
        item={item}
        weightUnit="g"
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
      <PackItemRow
        item={item}
        weightUnit="g"
        onUpdate={onUpdate}
        onSaveWeight={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit weight 1200 g for Backpack' }))

    expect(onUpdate).not.toHaveBeenCalled()
  })

  // A row given no save handler must not offer an editor it cannot save.
  it('leaves the weight static when no save handler is supplied', () => {
    render(<PackItemRow item={item} weightUnit="g" />)

    expect(screen.queryByRole('button', { name: /Edit weight/ })).toBeNull()
  })
})

describe('SortableItemRow activator', () => {
  it.each([false, true])('renders a named, focusable handle when isBelowLg=%s', (isBelowLg) => {
    render(<SortableItemRow item={item} weightUnit="g" isBelowLg={isBelowLg} />)

    const handle = screen.getByRole('button', { name: 'Reorder Backpack' })
    expect(handle).toHaveAttribute('tabindex', '0')
  })
  // One props object (section-parts buildRowProps) serves both rows; packMode
  // picks which one the wrapper renders.
  it('renders the Pack checklist row when packMode is set, and the edit row otherwise', () => {
    render(<SortableItemRow item={item} weightUnit="g" isBelowLg={false} packMode />)
    expect(screen.getByRole('checkbox', { name: 'Mark Backpack ready' })).toBeInTheDocument()
    cleanup()

    render(<SortableItemRow item={item} weightUnit="g" isBelowLg={false} />)
    expect(screen.queryByRole('checkbox', { name: 'Mark Backpack ready' })).toBeNull()
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

// A pending add's row is in the cache, so it renders, but it has no server row
// yet: any write naming its id fails. The handlers every row gets come from
// buildRowProps, so a pending row gets none, and the wrapper locks its drag.
describe('a row whose add is still pending', () => {
  const pending: ListItemWithGear = { ...item, id: unconfirmedId() }
  const handlers = {
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onSaveGearName: vi.fn(),
    onSaveGearDescription: vi.fn(),
    onSaveGearWeight: vi.fn(),
    onEditGearItem: vi.fn(),
    onSetGearStatus: vi.fn(),
  }
  const props = (packMode: boolean) => buildRowProps(pending, {
    ...handlers,
    weightUnit: 'g',
    isBelowLg: false,
    packMode,
    reorderPending: false,
    rowAction: <button type="button">Move Backpack</button>,
  })

  it('gets no write handlers and no row action', () => {
    const built = props(true)
    const actions = [
      built.onUpdate, built.onSaveName, built.onSaveDescription, built.onSaveWeight,
      built.onDelete, built.onEditGearItem, built.onSetGearStatus, built.rowAction,
    ]
    expect(actions.filter((value) => value !== undefined)).toEqual([])
  })

  it('in Pack: the ticks and the grip are disabled and there is no move menu', () => {
    render(<SortableItemRow {...props(true)} />)
    expect(screen.getByRole('checkbox', { name: 'Mark Backpack ready' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reorder Backpack' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Move Backpack' })).toBeNull()
  })

  it('in Edit: the grip is disabled and there is no edit button', () => {
    render(<SortableItemRow {...props(false)} />)
    expect(screen.getByRole('button', { name: 'Reorder Backpack' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
  })

  it('a confirmed row keeps its handlers (control)', () => {
    const confirmed = buildRowProps(item, {
      ...handlers,
      weightUnit: 'g',
      isBelowLg: false,
      packMode: true,
      reorderPending: false,
    })
    expect(confirmed.onUpdate).toBeTypeOf('function')
    render(<SortableItemRow {...confirmed} />)
    expect(screen.getByRole('checkbox', { name: 'Mark Backpack ready' })).toBeEnabled()
  })
})
