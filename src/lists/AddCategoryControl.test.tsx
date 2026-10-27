// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddCategoryControl from './AddCategoryControl'
import type { Category } from '../lib/types'

// Creating a category must not require leaving the list for the Gear page.
// This control creates the same shared category the Gear page manages; only
// the entry point is different.

const created: Category = { id: 'c-new', name: 'Shelter', sortOrder: 0, createdAt: '2026-01-01' }

afterEach(() => cleanup())

describe('AddCategoryControl', () => {
  it('creates on Enter and reports the new category', async () => {
    const onCreate = vi.fn().mockResolvedValue(created)
    const onCreated = vi.fn()
    render(<AddCategoryControl onCreate={onCreate} onCreated={onCreated} />)

    await userEvent.click(screen.getByRole('button', { name: 'Add category' }))
    await userEvent.type(screen.getByLabelText('Category name'), 'Shelter{Enter}')

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created))
    expect(onCreate).toHaveBeenCalledWith('Shelter')
    // The input resets to the button so the control is ready for the next one.
    expect(screen.getByRole('button', { name: 'Add category' })).toBeInTheDocument()
  })

  it('drops a repeat submit while a create is in flight', async () => {
    // Same failure shape as the duplicate-list bug: Enter plus a late blur
    // must not create two categories.
    let finish!: (c: Category) => void
    const onCreate = vi.fn().mockReturnValue(new Promise<Category>((resolve) => { finish = resolve }))
    render(<AddCategoryControl onCreate={onCreate} onCreated={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Add category' }))
    const input = screen.getByLabelText('Category name')
    await userEvent.type(input, 'Shelter{Enter}')
    await userEvent.keyboard('{Enter}')
    input.blur()

    finish(created)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add category' })).toBeInTheDocument())
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('does nothing on a blank name and cancels on Escape', async () => {
    const onCreate = vi.fn()
    render(<AddCategoryControl onCreate={onCreate} onCreated={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Add category' }))
    await userEvent.keyboard('{Enter}')
    expect(onCreate).not.toHaveBeenCalled()

    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Add category' })).toBeInTheDocument()
  })

  it('reports a failed create inline and lets the user retry', async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(created)
    const onCreated = vi.fn()
    render(<AddCategoryControl onCreate={onCreate} onCreated={onCreated} />)

    await userEvent.click(screen.getByRole('button', { name: 'Add category' }))
    await userEvent.type(screen.getByLabelText('Category name'), 'Shelter{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't confirm/)

    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created))
  })
})
