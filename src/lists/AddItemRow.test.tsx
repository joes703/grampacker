// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AddItemRow from './AddItemRow'
import { dismissToast, getToasts } from '../lib/toast'

afterEach(() => {
  cleanup()
  getToasts().forEach((toast) => dismissToast(toast.id))
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
    // here means two created rows, not a harmless duplicate PATCH.
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

describe('AddItemRow limits', () => {
  it('keeps the row open with the typed name when the weight is over the limit', () => {
    const { onSubmit, onCancel, nameInput } = renderRow()
    fireEvent.change(nameInput, { target: { value: 'Tent stakes' } })
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: '999999' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(nameInput).toHaveValue('Tent stakes')
    expect(getToasts().map((t) => t.message)).toEqual(['Weight must be 0 to 100 kg. Not saved.'])
  })

  it('refuses a bad quantity on blur from any field, then adds once it is fixed', () => {
    const { onSubmit, nameInput } = renderRow()
    fireEvent.change(nameInput, { target: { value: 'Tent stakes' } })
    const quantity = screen.getByLabelText('Quantity')
    fireEvent.change(quantity, { target: { value: '0' } })
    fireEvent.blur(nameInput)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(getToasts().map((t) => t.message)).toEqual(['Quantity must be 1 to 9999. Not saved.'])

    // The refusal must not use up the once-per-render guard: nothing
    // re-rendered, and this Enter still has to work.
    fireEvent.change(quantity, { target: { value: '2' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('refuses twice in a row without a render between', () => {
    const { onSubmit, onCancel, nameInput } = renderRow()
    fireEvent.change(nameInput, { target: { value: 'Tent stakes' } })
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '0' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })
    fireEvent.keyDown(nameInput, { key: 'Escape' })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
