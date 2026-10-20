// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InlineText from './InlineText'

afterEach(() => {
  cleanup()
})

function openEditor(value = 'Old note') {
  const onSave = vi.fn()
  render(<InlineText value={value} onSave={onSave} />)
  fireEvent.click(screen.getByText(value))
  const input = screen.getByDisplayValue(value)
  return { onSave, input }
}

describe('InlineText commit-once', () => {
  it('saves once when Enter and blur land in the same batch', () => {
    const { onSave, input } = openEditor()
    fireEvent.change(input, { target: { value: 'New note' } })
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.blur(input)
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('New note')
  })

  it('a same-batch blur cannot override Escape into a save', () => {
    const { onSave, input } = openEditor()
    fireEvent.change(input, { target: { value: 'Discarded' } })
    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' })
      fireEvent.blur(input)
    })
    expect(onSave).not.toHaveBeenCalled()
    // Editor closed back to display mode.
    expect(screen.getByText('Old note')).toBeTruthy()
  })

  it('a fresh edit session after a save works (guard re-arms)', () => {
    const onSave = vi.fn()
    render(<InlineText value="Old note" onSave={onSave} />)
    fireEvent.click(screen.getByText('Old note'))
    let input = screen.getByDisplayValue('Old note')
    fireEvent.change(input, { target: { value: 'First' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledTimes(1)
    // Session two: the swap re-rendered, so the guard is open again. The
    // test parent never feeds the new value back in, so the draft still
    // holds the last edit.
    fireEvent.click(screen.getByText('Old note'))
    input = screen.getByDisplayValue('First')
    fireEvent.change(input, { target: { value: 'Second' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith('Second')
  })
})

// Empty drafts: by default a cleared draft commits nothing (name fields keep
// the non-blank rule). `allowEmpty` opts a field into emitting '' so its
// caller can convert to the null the write contract requires - the contract
// rejects '' (shared/schema-primitives.ts descriptionSchema).
describe('InlineText empty drafts', () => {
  it('without allowEmpty, clearing the value commits nothing', () => {
    const { onSave, input } = openEditor()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('with allowEmpty, clearing a non-empty value commits the empty string', () => {
    const onSave = vi.fn()
    render(<InlineText value="Old note" onSave={onSave} allowEmpty />)
    fireEvent.click(screen.getByText('Old note'))
    const input = screen.getByDisplayValue('Old note')
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('')
  })

  it('with allowEmpty, an already-empty value commits nothing', () => {
    const onSave = vi.fn()
    render(
      <InlineText value="" placeholder="Add description" onSave={onSave} allowEmpty />,
    )
    fireEvent.click(screen.getByText('Add description'))
    fireEvent.blur(screen.getByDisplayValue(''))
    expect(onSave).not.toHaveBeenCalled()
  })
})
