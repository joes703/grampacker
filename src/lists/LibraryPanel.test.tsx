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
  it('names the gear search control', () => {
    render(
      <LibraryPanel
        gearItems={[item]}
        categories={[category]}
        listItemGearIds={new Set()}
        weightUnit="g"
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.getByRole('searchbox', { name: 'Search gear to add' })).toBeInTheDocument()
  })

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

// The in-list state used to be one step of grey on the name and nothing else,
// which is not enough to scan a long library with or to confirm that a tap
// did anything. These assert a signal that is PRESENT or ABSENT rather than
// lighter or darker - the property that made it readable - so a future
// styling pass cannot quietly collapse it back to a shade.
describe('gear picker shows plainly what is already on the list', () => {
  const both: GearItem[] = [
    item,
    { ...item, id: 'gear-2', name: 'Quilt' },
  ]

  function markFor(name: string) {
    // The mark is decorative (aria-hidden), so it is found structurally: the
    // row's first child slot. Querying it this way is the point - it asserts
    // the mark occupies a fixed leading column on every row, which is what
    // lets the marks line up into a scannable column.
    const row = screen.getByRole('button', { name: new RegExp(`${name} (from|to) list`) })
    return row.firstElementChild
  }

  it('marks the row for gear already on the list, and leaves the others unmarked', () => {
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

    expect(markFor('Tarp')?.querySelector('svg')).not.toBeNull()
    expect(markFor('Quilt')?.querySelector('svg')).toBeNull()
  })

  // Both rows reserve the slot whether or not they fill it. Without this the
  // marked rows would sit indented from the unmarked ones and the column
  // would not line up.
  it('reserves the mark column on every row', () => {
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

    for (const name of ['Tarp', 'Quilt']) {
      expect(markFor(name)?.className).toContain('w-4')
    }
  })
})
