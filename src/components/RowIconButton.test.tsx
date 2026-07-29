// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import RowIconButton from './RowIconButton'
import { ROW_LEADING_CONTROL_TARGET } from './flat-table-styles'

afterEach(cleanup)

describe('RowIconButton', () => {
  it('uses the responsive row-control target when it can render below lg', () => {
    render(<RowIconButton icon={<span />} ariaLabel="Move item" touchSafe />)

    expect(screen.getByRole('button', { name: 'Move item' }).className).toContain(
      'h-10 w-10 lg:h-7 lg:w-7',
    )
  })

  it('keeps the compact target for desktop-only row controls', () => {
    render(<RowIconButton icon={<span />} ariaLabel="Edit item" />)

    expect(screen.getByRole('button', { name: 'Edit item' }).className).toContain('w-7 h-6')
  })

  it('gives a drag handle the narrow LEADING-column box, not the square one', () => {
    // A row's grip and a section header's collapse chevron occupy the same
    // column. If the grip narrows on its own, every item name shifts left of
    // the category title above it - an 8px misalignment that DOM-order tests
    // cannot see. Both sides read this one token, and this asserts the grip
    // side is still wired to it.
    render(
      <RowIconButton icon={<span />} ariaLabel="Drag Tarp" variant="dragHandle" touchSafe />,
    )

    const handle = screen.getByRole('button', { name: 'Drag Tarp' })
    expect(handle.className).toContain(ROW_LEADING_CONTROL_TARGET)
    // Spelled out as well as compared to the token: asserting only against the
    // token would keep passing if the token itself lost its widths.
    expect(handle.className).toContain('h-10 w-10 lg:h-7 lg:w-5')
    expect(handle.className).not.toContain('lg:w-7')
  })
})
