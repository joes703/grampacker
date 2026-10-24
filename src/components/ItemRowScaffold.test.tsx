// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NameDescriptionCell } from './ItemRowScaffold'

// Desktop name/description layout rules: the two cells are fixed
// proportional columns, so descriptions line up down a table; and an empty
// description's "Add description" affordance stays quiet until the pointer is
// on the row (opacity, so it remains keyboard-focusable and reveals on focus).

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

  // jsdom has no layout, so the proof is the sizing classes. A name cell sized
  // to its own text (no flex share) starts every description at a different
  // x, which is the ragged column this guards against.
  it('sizes name and description as fixed 3:2 columns, whatever the name length', () => {
    for (const name of ['Tarp', 'Dutchware Hellbender with a very long product name']) {
      render(
        <NameDescriptionCell status="active" name={name} description="11ft, winter tarp" />,
      )
      const nameCell = screen.getByText(name).parentElement as HTMLElement
      const descriptionCell = screen.getByText('11ft, winter tarp').parentElement as HTMLElement
      expect(nameCell.className).toContain('flex-[3]')
      expect(nameCell.className).not.toMatch(/max-w-/)
      expect(descriptionCell.className).toContain('flex-[2]')
      cleanup()
    }
  })
})
