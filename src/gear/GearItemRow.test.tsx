// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
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
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Loaned out' }))

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
