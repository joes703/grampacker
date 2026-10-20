// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Category } from '../lib/types'
import InlineCreateCategory from './InlineCreateCategory'

// GearLibraryPage.save-errors.test.tsx pins the toolbar variant's behavior
// through the real page (late answers against the page's dialog slot, the
// double-submit guard, error-in-place). This file pins the component's own
// contract directly, where both variants share it - above all the part no
// page test reaches from the dialog side: a create that settles after the
// editor is gone must not call back into the parent.

const created: Category = {
  id: 'c-new',
  name: 'Sleep system',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(cleanup)

describe('InlineCreateCategory', () => {
  it('commits the trimmed name and hands the created category to the parent', async () => {
    const create = vi.fn().mockResolvedValue(created)
    const onCreated = vi.fn()
    render(
      <InlineCreateCategory
        variant="toolbar"
        create={create}
        onCreated={onCreated}
        onCancel={() => {}}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('Category name'), {
      target: { value: '  Sleep system  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created))
    expect(create).toHaveBeenCalledWith('Sleep system')
  })

  it('holds the typed name and reports the failure in place, then allows a retry', async () => {
    const create = vi.fn().mockRejectedValue(new Error('nope'))
    render(
      <InlineCreateCategory
        variant="form"
        create={create}
        onCreated={() => {}}
        onCancel={() => {}}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('Category name'), {
      target: { value: 'Sleep system' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't confirm the category was created. Refresh before retrying, in case it was.",
    )
    expect(screen.getByPlaceholderText('Category name')).toHaveValue('Sleep system')
    expect(screen.getByRole('button', { name: 'Create category' })).toBeEnabled()
  })

  it('will not submit twice while the first create is still out', async () => {
    // Category names are not unique in the schema, so an unguarded repeat -
    // Enter repeats on its own - quietly creates a second category.
    const d = deferred<Category>()
    const create = vi.fn().mockReturnValue(d.promise)
    render(
      <InlineCreateCategory
        variant="toolbar"
        create={create}
        onCreated={() => {}}
        onCancel={() => {}}
      />,
    )
    const input = screen.getByPlaceholderText('Category name')
    fireEvent.change(input, { target: { value: 'Sleep system' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('button', { name: 'Adding…' })).toBeDisabled()
    expect(input).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Adding…' }))
    expect(create).toHaveBeenCalledTimes(1)
    d.resolve(created)
  })

  it('a create that settles after the editor is gone calls nothing back', async () => {
    // The parent closes (and resets) the editor by unmounting it; every other
    // dialog on the gear page replaces it the same way. A success landing
    // afterwards must not call onCreated - the parent would close whatever
    // dialog it has open NOW.
    const d = deferred<Category>()
    const onCreated = vi.fn()
    const { unmount } = render(
      <InlineCreateCategory
        variant="toolbar"
        create={() => d.promise}
        onCreated={onCreated}
        onCancel={() => {}}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('Category name'), {
      target: { value: 'Sleep system' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    unmount()
    d.resolve(created)
    // Flush the continuation before asserting the absence.
    await Promise.resolve()
    await Promise.resolve()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('Escape cancels; Enter does not submit an enclosing form', () => {
    const onCancel = vi.fn()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <InlineCreateCategory
          variant="form"
          create={() => Promise.resolve(created)}
          onCreated={() => {}}
          onCancel={onCancel}
        />
      </form>,
    )
    const input = screen.getByPlaceholderText('Category name')
    fireEvent.change(input, { target: { value: 'Sleep system' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
