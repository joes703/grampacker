// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AddItemRow from './AddItemRow'

afterEach(() => {
  cleanup()
})

function renderRow() {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(<AddItemRow onSubmit={onSubmit} onCancel={onCancel} />)
  const nameInput = screen.getByPlaceholderText('Item name')
  return { onSubmit, onCancel, nameInput }
}

describe('AddItemRow commit-once', () => {
  it('submits once when Enter and the row blur land in the same batch', () => {
    const { onSubmit, nameInput } = renderRow()
    fireEvent.change(nameInput, { target: { value: 'Tent stakes' } })
    // Quick-add creates gear + list item server-side; a double delivery
    // here used to mean two created rows, not a harmless duplicate PATCH.
    act(() => {
      fireEvent.keyDown(nameInput, { key: 'Enter' })
      fireEvent.blur(nameInput)
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Tent stakes' }),
    )
  })

  it('a same-batch blur cannot override Escape into a submit', () => {
    const { onSubmit, onCancel, nameInput } = renderRow()
    fireEvent.change(nameInput, { target: { value: 'Tent stakes' } })
    act(() => {
      fireEvent.keyDown(nameInput, { key: 'Escape' })
      fireEvent.blur(nameInput)
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Enter on a blank name does not consume the guard: Escape still cancels', () => {
    const { onSubmit, onCancel, nameInput } = renderRow()
    act(() => {
      fireEvent.keyDown(nameInput, { key: 'Enter' })
      fireEvent.keyDown(nameInput, { key: 'Escape' })
    })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('tabbing between the row inputs does not commit', () => {
    const { onSubmit, onCancel, nameInput } = renderRow()
    fireEvent.change(nameInput, { target: { value: 'Tent stakes' } })
    const descInput = screen.getByPlaceholderText('Description (optional)')
    fireEvent.blur(nameInput, { relatedTarget: descInput })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })
})
