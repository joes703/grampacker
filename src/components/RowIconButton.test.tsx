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
      'h-10 w-10 lg:h-7 lg:w-6',
    )
  })

  it('narrows the compact target only at lg, keeping 28px below it', () => {
    // The compact button is nominally desktop-only, but AddItemRow mounts
    // non-touchSafe instances that survive a resize below lg once the form is
    // open. An unprefixed w-6 would therefore shrink a REAL mobile target
    // from 28px to 24px, which the density doc forbids: tuning desktop must
    // never move touch sizing. Both halves are pinned because dropping either
    // one is silent - the class string still looks plausible.
    render(<RowIconButton icon={<span />} ariaLabel="Edit item" />)

    // toHaveClass, not substring matching: `className.toContain('w-7')` is
    // also satisfied by `lg:w-7`, so the assertion that is supposed to pin the
    // MOBILE fallback would pass against the exact regression it guards.
    expect(screen.getByRole('button', { name: 'Edit item' })).toHaveClass(
      'w-7',
      'lg:w-6',
      'h-6',
    )
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

describe('print', () => {
  // Every drag grip, kebab, nest handle and inline edit/delete in the app is
  // one of these. Hiding them here is what makes the print tier work: they
  // are 40px touch targets, and while one renders it - not min-height - sets
  // the row's height on paper.
  it('never prints', () => {
    render(<RowIconButton icon={<span />} ariaLabel="Reorder" />)
    expect(screen.getByRole('button', { name: 'Reorder' }).className).toContain('print:hidden')
  })

  it('still prints nothing when a call site passes its own className', () => {
    render(<RowIconButton icon={<span />} ariaLabel="Move" className="opacity-0" />)
    const cls = screen.getByRole('button', { name: 'Move' }).className
    expect(cls).toContain('print:hidden')
    expect(cls).toContain('opacity-0')
  })
})
