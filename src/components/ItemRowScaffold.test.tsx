// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NameDescriptionCell } from './ItemRowScaffold'

// Desktop name/description layout rules from the 2026-10 UX audits: in a
// gear list the NAME is the content, so it takes space first and the
// description truncates first; and an empty description's "Add description"
// affordance stays quiet until the pointer is on the row (opacity, so it
// remains keyboard-focusable and reveals on focus).

afterEach(() => cleanup())

describe('NameDescriptionCell', () => {
  it('reveals an empty description’s placeholder only on row hover or focus', () => {
    render(
      <NameDescriptionCell
        status="active"
        name="Dutchware Hellbender"
        description=""
        onSaveDescription={vi.fn()}
      />,
    )
    const placeholder = screen.getByText('Add description')
    const cell = placeholder.closest('.group-hover\\:opacity-100')
    expect(cell).not.toBeNull()
  })

  it('always shows a description that has content', () => {
    render(
      <NameDescriptionCell
        status="active"
        name="Dutchware Hellbender"
        description="11ft, winter tarp"
        onSaveDescription={vi.fn()}
      />,
    )
    const description = screen.getByText('11ft, winter tarp')
    expect(description.closest('.group-hover\\:opacity-100')).toBeNull()
  })
})
