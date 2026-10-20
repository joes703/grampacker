// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InlineRenameInput from './InlineRenameInput'

afterEach(() => {
  cleanup()
})

function renderInput(selectOnOpen?: boolean) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  const onChange = vi.fn()
  render(
    <InlineRenameInput
      value="Old name"
      onChange={onChange}
      onSubmit={onSubmit}
      onCancel={onCancel}
      ariaLabel="Rename"
      selectOnOpen={selectOnOpen}
    />,
  )
  const input = screen.getByLabelText('Rename') as HTMLInputElement
  return { onSubmit, onCancel, onChange, input }
}

describe('InlineRenameInput', () => {
  it('commits once when Enter and blur land in the same batch', () => {
    const { onSubmit, input } = renderInput()
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.blur(input)
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('a same-batch blur cannot override Escape into a save', () => {
    const { onSubmit, onCancel, input } = renderInput()
    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' })
      fireEvent.blur(input)
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('blur alone commits', () => {
    const { onSubmit, input } = renderInput()
    fireEvent.blur(input)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('selects the value on mount by default, focuses without selecting when disabled', () => {
    const first = renderInput()
    expect(first.input.selectionStart).toBe(0)
    expect(first.input.selectionEnd).toBe('Old name'.length)
    cleanup()
    const second = renderInput(false)
    expect(document.activeElement).toBe(second.input)
    expect(second.input.selectionEnd).toBe(second.input.selectionStart)
  })
})
