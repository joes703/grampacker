// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import InlineQuantity from './InlineQuantity'
import { dismissToast, getToasts } from '../lib/toast'

afterEach(() => {
  cleanup()
  getToasts().forEach((toast) => dismissToast(toast.id))
})

function startEditing() {
  const onSave = vi.fn()
  render(<InlineQuantity quantity={3} max={9999} onSave={onSave} itemName="Tarp" />)
  fireEvent.click(screen.getByRole('button', { name: /Edit quantity/ }))
  return { onSave, input: screen.getByLabelText('Quantity for Tarp') }
}

describe('InlineQuantity limits', () => {
  it.each(['0', '10000', '-1'])('does not save %s, and keeps the old number', (value) => {
    const { onSave, input } = startEditing()
    fireEvent.change(input, { target: { value } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
    expect(getToasts().map((t) => t.message)).toEqual(['Quantity must be 1 to 9999. Not saved.'])
    expect(screen.getByRole('button', { name: /Edit quantity 3/ })).toBeInTheDocument()
  })

  it('reopens on the old number after a refusal', () => {
    const { input } = startEditing()
    fireEvent.change(input, { target: { value: '10000' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /Edit quantity/ }))

    expect(screen.getByLabelText('Quantity for Tarp')).toHaveValue(3)
  })

  it('saves a number inside the limits', () => {
    const { onSave, input } = startEditing()
    fireEvent.change(input, { target: { value: '9999' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSave).toHaveBeenCalledWith(9999)
    expect(getToasts()).toHaveLength(0)
  })
})
