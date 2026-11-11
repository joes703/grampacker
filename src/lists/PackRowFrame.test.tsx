// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import PackRowFrame from './PackRowFrame'

afterEach(cleanup)

describe('PackRowFrame', () => {
  // jsdom has no layout, so the proof is the sizing classes. The pack row
  // keeps the edit rows' name : description proportion (NameDescriptionCell,
  // pinned in ItemRowScaffold.test.tsx), so the two modes of the same list
  // put the description column in the same place.
  it('sizes name and description as 3:2 columns, like the edit rows', () => {
    render(
      <PackRowFrame
        name="Dutchware Hellbender"
        isPacked={false}
        isReady={false}
        description={<span>11ft, winter tarp</span>}
      />,
    )
    const nameCell = screen.getByText('Dutchware Hellbender').parentElement as HTMLElement
    const descriptionCell = screen.getByText('11ft, winter tarp').parentElement as HTMLElement
    expect(nameCell.className).toContain('flex-[3]')
    expect(descriptionCell.className).toContain('lg:flex-[2]')
  })
})
