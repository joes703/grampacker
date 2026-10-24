// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GearItemRow, { SortableGearItemRow } from './GearItemRow'
import type { GearItem } from '../lib/types'

// Locks the entity-aware row callback contract introduced with the gear-row
// memoization (P5). The row now binds its own item/id internally, so these
// assertions guard that the bind args stay correct after the refactor. Renders
// GearItemRow directly (the leaf) - useSortable lives in SortableGearItemRow,
// so no DndContext is needed here.

afterEach(cleanup)

function gear(overrides: Partial<GearItem> = {}): GearItem {
  return {
    id: 'gear-1',
    categoryId: null,
    name: 'Tent',
    description: 'Two-person',
    weightGrams: 1200,
    cost: null,
    purchaseDate: null,
    status: 'active',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function baseProps() {
  return {
    weightUnit: 'g' as const,
    isBelowLg: false,
    selectMode: false,
    selected: false,
    onToggleSelect: vi.fn(),
    onInlineSave: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onSetStatus: vi.fn(),
  }
}

describe('GearItemRow callback contracts', () => {
  it('focuses the popover surface on open and returns focus on Escape', async () => {
    render(<GearItemRow item={gear()} {...baseProps()} />)
    const trigger = screen.getByRole('button', { name: 'Item options' })

    fireEvent.click(trigger)

    await waitFor(() => expect(screen.getByRole('group', { name: 'Item actions' })).toHaveFocus())
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('menuitem')).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger).toHaveFocus()
  })

  it('kebab Edit calls onEdit with the item', () => {
    const item = gear()
    const props = baseProps()
    render(<GearItemRow item={item} {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Item options' }))
    fireEvent.click(screen.getByText('Edit'))

    expect(props.onEdit).toHaveBeenCalledTimes(1)
    expect(props.onEdit).toHaveBeenCalledWith(item)
  })

  it('kebab Delete from inventory calls onDelete with the item', () => {
    const item = gear()
    const props = baseProps()
    render(<GearItemRow item={item} {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Item options' }))
    fireEvent.click(screen.getByText('Delete from inventory'))

    expect(props.onDelete).toHaveBeenCalledTimes(1)
    expect(props.onDelete).toHaveBeenCalledWith(item)
  })

  it('kebab status change calls onSetStatus with (id, status)', () => {
    const item = gear({ id: 'gear-9', status: 'active' })
    const props = baseProps()
    render(<GearItemRow item={item} {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Item options' }))
    fireEvent.click(screen.getByRole('button', { name: 'Loaned out' }))

    expect(props.onSetStatus).toHaveBeenCalledTimes(1)
    expect(props.onSetStatus).toHaveBeenCalledWith('gear-9', 'loaned_out')
  })

  it('select-mode checkbox calls onToggleSelect with the item id', () => {
    const item = gear({ id: 'gear-3', name: 'Stove' })
    const props = { ...baseProps(), selectMode: true }
    render(<GearItemRow item={item} {...props} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Stove' }))

    expect(props.onToggleSelect).toHaveBeenCalledTimes(1)
    expect(props.onToggleSelect).toHaveBeenCalledWith('gear-3')
  })
})

describe('SortableGearItemRow activator', () => {
  it.each([false, true])('renders a named, focusable handle when isBelowLg=%s', (isBelowLg) => {
    render(<SortableGearItemRow item={gear()} {...baseProps()} isBelowLg={isBelowLg} />)

    const handle = screen.getByRole('button', { name: 'Reorder Tent' })
    expect(handle).toHaveAttribute('tabindex', '0')
  })
})

// Joe's first complaint of the packing-workflow review: "I should be able to
// inline add or edit grams in gear page." The list row could already do this;
// this page could only reach a weight through the dialog. Both now go through
// the shared InlineWeight control.
describe('GearItemRow inline weight', () => {
  it('saves a weight edited in place', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    render(<GearItemRow item={gear()} {...props} />)

    await user.click(screen.getByRole('button', { name: 'Edit weight 1200 g for Tent' }))
    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '850')
    // Enter rather than Tab: WeightInput contains its own g/oz toggle, so Tab
    // moves focus within the component and its onBlur deliberately holds.
    await user.keyboard('{Enter}')

    expect(props.onInlineSave).toHaveBeenCalledWith('gear-1', { weightGrams: 850 })
  })

  it('leaves the weight static in select mode, where the row belongs to the selection', () => {
    render(<GearItemRow item={gear()} {...baseProps()} selectMode />)

    expect(screen.queryByRole('button', { name: /Edit weight/ })).toBeNull()
    expect(screen.getByLabelText('1200 g')).toBeInTheDocument()
  })
})

// Clearing the two inline text cells diverges on purpose: a description
// clears to NULL (the write contract rejects '' - clients send null), while
// a name keeps the non-blank rule and commits nothing.
describe('GearItemRow inline description clearing', () => {
  it('clearing the description saves null', () => {
    const props = baseProps()
    render(<GearItemRow item={gear()} {...props} />)
    fireEvent.click(screen.getByText('Two-person'))
    const input = screen.getByDisplayValue('Two-person')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onInlineSave).toHaveBeenCalledWith('gear-1', { description: null })
  })

  it('clearing the name saves nothing', () => {
    const props = baseProps()
    render(<GearItemRow item={gear()} {...props} />)
    fireEvent.click(screen.getByText('Tent'))
    const input = screen.getByDisplayValue('Tent')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onInlineSave).not.toHaveBeenCalled()
  })
})

// POLICY: in select mode the row's affordances belong to the selection -
// everything is read-only. The weight cell and the hidden kebab already
// followed this rule; name and description used to stay editable, giving
// three different answers to "is this row editable during selection".
describe('GearItemRow select mode', () => {
  it('name and description are read-only during selection', () => {
    const props = baseProps()
    render(<GearItemRow item={gear()} {...props} selectMode />)
    fireEvent.click(screen.getByText('Tent'))
    fireEvent.click(screen.getByText('Two-person'))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(props.onInlineSave).not.toHaveBeenCalled()
  })

  it('keeps the description cell on rows without one, so row geometry stays uniform', () => {
    // Dropping the description cell entirely on description-less rows once
    // made name cells stop lining up in select mode. The cell must exist on
    // every row (an exceptional structural assert: the cell's presence IS
    // the regression). Empty descriptions now hide by OPACITY, never by
    // removal - the opacity-gated wrapper is the structural proof.
    const { container } = render(
      <GearItemRow item={gear({ description: null })} {...baseProps()} selectMode />,
    )
    expect(container.querySelector('.opacity-0.flex-\\[2\\]')).not.toBeNull()
  })
})
