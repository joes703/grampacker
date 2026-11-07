// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import InlineWeight from './InlineWeight'
import { dismissToast, getToasts } from '../lib/toast'

afterEach(() => {
  cleanup()
  getToasts().forEach((toast) => dismissToast(toast.id))
  localStorage.clear()
})

function startEditing() {
  const onSave = vi.fn()
  render(<InlineWeight grams={500} unit="g" onSave={onSave} itemName="Tarp" />)
  fireEvent.click(screen.getByRole('button', { name: /Edit weight/ }))
  return { onSave, input: screen.getByLabelText('Weight for Tarp') }
}

describe('InlineWeight limits', () => {
  it.each(['999999', '-5'])('does not save %s, and keeps the old number', (value) => {
    const { onSave, input } = startEditing()
    fireEvent.change(input, { target: { value } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
    expect(getToasts().map((t) => t.message)).toEqual(['Weight must be 0 to 100 kg. Not saved.'])
    expect(screen.getByLabelText('500 g')).toBeInTheDocument()
  })

  it('also refuses when the field loses focus', () => {
    const { onSave, input } = startEditing()
    fireEvent.change(input, { target: { value: '999999' } })
    fireEvent.blur(input)

    expect(onSave).not.toHaveBeenCalled()
    expect(getToasts()).toHaveLength(1)
  })

  it('reopens on the old number after a refusal', () => {
    const { input } = startEditing()
    fireEvent.change(input, { target: { value: '999999' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /Edit weight/ }))

    expect(screen.getByLabelText('Weight for Tarp')).toHaveValue(500)
  })

  it('saves a weight at the limit', () => {
    const { onSave, input } = startEditing()
    fireEvent.change(input, { target: { value: '100000' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSave).toHaveBeenCalledWith(100000)
    expect(getToasts()).toHaveLength(0)
  })

  it('still rounds a finer weight instead of refusing it', () => {
    // Too many decimals is not over a limit, and rounding it changes nothing
    // anyone would notice.
    const { onSave, input } = startEditing()
    fireEvent.change(input, { target: { value: '2.15' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(getToasts()).toHaveLength(0)
  })
})
