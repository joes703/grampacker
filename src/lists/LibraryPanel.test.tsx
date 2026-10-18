// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Category, GearItem } from '../lib/types'
import LibraryPanel from './LibraryPanel'

// jsdom implements <dialog> without its modal methods, and the quick-add form
// is a Modal. Same shim the ListDetailPage suites use.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.open = false }
  }
})

afterEach(() => {
  cleanup()
})

const item: GearItem = {
  id: 'gear-1',
  categoryId: 'cat-1',
  name: 'Tarp',
  description: null,
  weightGrams: 250.5,
  cost: null,
  purchaseDate: null,
  status: 'active',
  sortOrder: 0,
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
}

const category: Category = {
  id: 'cat-1',
  name: 'Shelter',
  sortOrder: 0,
  createdAt: '2026-06-06T00:00:00.000Z',
}

describe('gear picker search control', () => {
  it('binds each search input to its own label when two panels are mounted', () => {
    const props = {
      gearItems: [item],
      categories: [category],
      listItemGearIds: new Set<string>(),
      weightUnit: 'g' as const,
      onAdd: vi.fn(),
      onRemove: vi.fn(),
    }
    render(
      <>
        <section data-testid="gear-picker-a"><LibraryPanel {...props} /></section>
        <section data-testid="gear-picker-b"><LibraryPanel {...props} /></section>
      </>,
    )

    const ids = screen.getAllByTestId(/gear-picker-/).map((panel) => {
      const label = within(panel).getByText('Search gear to add') as HTMLLabelElement
      const input = within(panel).getByRole('searchbox')
      expect(label.control).toBe(input)
      expect(input).toHaveAccessibleName('Search gear to add')
      return input.id
    })
    expect(new Set(ids).size).toBe(2)
  })
})

// Creating a brand-new item was the one thing Pack could not do: the picker
// only ever added gear that already existed, and CategoryGroup gates its
// "+ Add new item" footer on !packMode. The control lives here rather than in
// a section footer because the picker means the same thing in both
// arrangements - a Pack section is a BAG, and a footer add there has no
// category to offer.
describe('creating a new item from the picker', () => {
  const base = {
    gearItems: [item],
    categories: [category],
    listItemGearIds: new Set<string>(),
    weightUnit: 'g' as const,
    onAdd: vi.fn(),
    onRemove: vi.fn(),
  }

  it('offers no New item control when the host passes no handler', () => {
    render(<LibraryPanel {...base} />)

    expect(screen.queryByRole('button', { name: 'New item' })).toBeNull()
  })

  it('hands the quick-add payload to the host', async () => {
    const onCreateNew = vi.fn()
    const user = userEvent.setup()
    render(<LibraryPanel {...base} onCreateNew={onCreateNew} />)

    await user.click(screen.getByRole('button', { name: 'New item' }))
    await user.type(screen.getByLabelText(/^Name/), 'Titanium spork')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    expect(onCreateNew).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Titanium spork' }),
    )
  })

  // The modal has no pending or inline-error surface, so it closes and the
  // create reports on the page it returns to.
  it('closes the modal before handing off', async () => {
    const onCreateNew = vi.fn()
    const user = userEvent.setup()
    render(<LibraryPanel {...base} onCreateNew={onCreateNew} />)

    await user.click(screen.getByRole('button', { name: 'New item' }))
    await user.type(screen.getByLabelText(/^Name/), 'Titanium spork')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    expect(screen.queryByLabelText(/^Name/)).toBeNull()
  })

  // The picker mounts OUTSIDE the page's detail gate, so without this a write
  // could succeed while the document says it could not load and the user has
  // no way to confirm what happened.
  it('disables the control with a stated reason when the list has not loaded', () => {
    render(
      <LibraryPanel
        {...base}
        onCreateNew={vi.fn()}
        createDisabledReason="Still loading this list."
      />,
    )

    const button = screen.getByRole('button', { name: 'New item' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription('Still loading this list.')
  })
})

describe('gear picker shows plainly what is already on the list', () => {
  const both: GearItem[] = [
    item,
    { ...item, id: 'gear-2', name: 'Quilt' },
  ]

  it('offers remove for included gear and add for gear outside the list', () => {
    render(
      <LibraryPanel
        gearItems={both}
        categories={[category]}
        listItemGearIds={new Set(['gear-1'])}
        weightUnit="g"
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Remove Tarp from list' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add Quilt to list' })).toBeEnabled()
  })
})
