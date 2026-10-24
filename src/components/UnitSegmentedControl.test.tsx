// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { UnitSegmentedControlView } from './UnitSegmentedControl'

afterEach(cleanup)

describe('UnitSegmentedControlView', () => {
  // A quiet value picker: gray track, white chip. The solid blue fill it used
  // to have is the selected-button look, and next to the list's view tabs it
  // read as navigation.
  it('marks the chosen unit with a white chip, not a blue fill', () => {
    render(<UnitSegmentedControlView value="oz" onValueChange={() => {}} />)
    const group = screen.getByRole('radiogroup', { name: 'Weight units' })
    expect(group).toHaveClass('bg-gray-100')
    expect(group).not.toHaveClass('border')
    const chosen = screen.getByText('oz')
    expect(chosen).toHaveClass('bg-white', 'text-gray-900')
    expect(chosen).not.toHaveClass('bg-blue-600')
    expect(screen.getByText('g')).toHaveClass('text-gray-500')
  })

  // The clickable labels carry the size, not the track: 40px on touch,
  // 28px at lg (docs/ui-density.md, density tiers).
  it('sizes each choice to the touch and pointer tiers', () => {
    render(<UnitSegmentedControlView value="g" onValueChange={() => {}} />)
    for (const name of ['g', 'oz']) {
      expect(screen.getByText(name)).toHaveClass(
        'inline-flex', 'items-center', 'justify-center', 'min-h-10', 'lg:min-h-7',
      )
    }
  })

})
