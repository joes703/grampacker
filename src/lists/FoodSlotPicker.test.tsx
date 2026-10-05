// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import FoodSlotPicker from './FoodSlotPicker'
import type { FoodSlotResponse } from '../../shared/food'

afterEach(cleanup)

const slot = (id: string, dayNumber: number, meal: 'breakfast' | 'lunch' | 'dinner'): FoodSlotResponse =>
  ({ id, dayNumber, meal })

function renderPicker(slots: readonly FoodSlotResponse[] = [], selected: string[] = []) {
  const { rerender } = render(
    <FoodSlotPicker slots={slots} selected={selected} onChange={() => {}} />
  )
  return { rerender }
}

describe('FoodSlotPicker', () => {
  it('renders full meal names as day toggles, not single letters', () => {
    const slots = [
      slot('b1', 1, 'breakfast'),
      slot('l1', 1, 'lunch'),
      slot('d1', 1, 'dinner'),
      slot('b2', 2, 'breakfast'),
      slot('l2', 2, 'lunch'),
      slot('d2', 2, 'dinner'),
    ]
    renderPicker(slots)
    const dayOneBreakfast = screen.getByRole('button', { name: 'Breakfast day 1' })
    expect(dayOneBreakfast).toHaveTextContent('Breakfast')
    expect(dayOneBreakfast).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggles whole meal: all slots of that meal on and off', () => {
    const slots = [
      slot('b1', 1, 'breakfast'),
      slot('b2', 2, 'breakfast'),
      slot('l1', 1, 'lunch'),
    ]
    const selected: string[] = []
    let currentSelected = selected
    const onChange = (next: string[]) => {
      currentSelected = next
    }
    const { rerender } = render(
      <FoodSlotPicker slots={slots} selected={currentSelected} onChange={onChange} />
    )

    // Click "Every breakfast" to select all breakfast slots
    const everyBreakfastBtn = screen.getByRole('button', { name: 'Every breakfast' })
    fireEvent.click(everyBreakfastBtn)
    expect(currentSelected).toEqual(['b1', 'b2'])

    // Rerender
    rerender(<FoodSlotPicker slots={slots} selected={currentSelected} onChange={onChange} />)
    expect(everyBreakfastBtn).toHaveAttribute('aria-pressed', 'true')
    // Each day's chip shows as on too, so one can be switched off on its own.
    expect(screen.getByRole('button', { name: 'Breakfast day 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Breakfast day 2' })).toHaveAttribute('aria-pressed', 'true')

    // Click again to deselect all breakfast
    fireEvent.click(everyBreakfastBtn)
    expect(currentSelected).toEqual([])
  })
})
