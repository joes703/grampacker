// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import QuickAddItemModal from './QuickAddItemModal'
import type { Category } from '../lib/types'

// jsdom implements <dialog> without its modal methods, and the quick-add form
// is a Modal. Same shim the LibraryPanel suite uses.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.open = false }
  }
})

// The modal serves two callers. From a category section's "Add item" the
// category is implicit and no selector renders. From the gear picker's "New
// item" there is no section, and without the selector every item would land
// in Uncategorized with nothing saying so.

const categories: Category[] = [
  { id: 'cat-b', name: 'Kitchen', sortOrder: 1, createdAt: '2024-01-01' },
  { id: 'cat-a', name: 'Shelter', sortOrder: 0, createdAt: '2024-01-01' },
]

afterEach(() => cleanup())

describe('QuickAddItemModal focus', () => {
  it('focuses the Name field when it opens', () => {
    // Modal pulls focus onto the dialog itself by default (sane for
    // menu-like modals - see Modal.tsx). This is a FORM whose next action
    // is always typing a name, so it opts into field focus.
    render(<QuickAddItemModal onSubmit={vi.fn()} onClose={vi.fn()} />)
    expect(document.activeElement?.id).toBe('qa-name')
  })
})

describe('QuickAddItemModal category selection', () => {
  it('offers the categories in sort order, defaulting to Uncategorized', async () => {
    render(
      <QuickAddItemModal categories={categories} onSubmit={vi.fn()} onClose={vi.fn()} />,
    )
    const select = screen.getByLabelText('Category') as HTMLSelectElement
    expect(select.value).toBe('')
    const labels = [...select.options].map((option) => option.textContent)
    expect(labels).toEqual(['Uncategorized', 'Shelter', 'Kitchen'])
  })

  it('submits the chosen category id alongside the item data', async () => {
    const onSubmit = vi.fn()
    render(
      <QuickAddItemModal categories={categories} onSubmit={onSubmit} onClose={vi.fn()} />,
    )
    await userEvent.type(screen.getByLabelText('Name'), 'Tarp')
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'cat-a')
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Tarp' }),
      'cat-a',
    )
  })

  it('submits null when Uncategorized is kept', async () => {
    const onSubmit = vi.fn()
    render(
      <QuickAddItemModal categories={categories} onSubmit={onSubmit} onClose={vi.fn()} />,
    )
    await userEvent.type(screen.getByLabelText('Name'), 'Tarp')
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Tarp' }), null)
  })

  it('renders no selector when the caller has an implicit category', () => {
    render(<QuickAddItemModal onSubmit={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('Category')).toBeNull()
  })
})
