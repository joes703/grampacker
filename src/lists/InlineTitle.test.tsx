// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InlineTitle from './InlineTitle'

afterEach(() => {
  cleanup()
})

// Edit mode is entered externally via the editTrigger counter (the pencil
// button lives in CurrentListHeader), so tests bump the prop.
function openEditor(name = 'Trip list') {
  const onSave = vi.fn()
  const { rerender } = render(
    <InlineTitle name={name} onSave={onSave} editTrigger={0} />,
  )
  rerender(<InlineTitle name={name} onSave={onSave} editTrigger={1} />)
  const input = screen.getByDisplayValue(name)
  return { onSave, input }
}

describe('InlineTitle commit-once', () => {
  it('saves once when Enter and blur land in the same batch', () => {
    const { onSave, input } = openEditor()
    fireEvent.change(input, { target: { value: 'Renamed trip' } })
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.blur(input)
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('Renamed trip')
  })

  it('a same-batch blur cannot override Escape into a save', () => {
    const { onSave, input } = openEditor()
    fireEvent.change(input, { target: { value: 'Discarded' } })
    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' })
      fireEvent.blur(input)
    })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Trip list')).toBeTruthy()
  })

  it('validation failure keeps the session usable: error, fix, save', () => {
    const { onSave, input } = openEditor()
    // Explicit save of an empty name renders the inline error and stays in
    // edit mode; the error render re-arms the guard for the retry.
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText("List name can't be empty")).toBeTruthy()
    fireEvent.change(input, { target: { value: 'Fixed name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('Fixed name')
  })
})
