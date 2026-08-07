// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import FoodSlotPicker from './FoodSlotPicker'
import type { FoodSlotResponse } from '../../shared/food'

afterEach(cleanup)

const slot = (id: string, dayNumber: number, meal: 'breakfast' | 'lunch' | 'dinner'): FoodSlotResponse =>
  ({ id, dayNumber, meal, needed: true })

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

  it('toggles a single slot on and off', () => {
    const slots = [slot('b1', 1, 'breakfast')]
    const selected: string[] = []
    let currentSelected = selected
    const onChange = (next: string[]) => {
      currentSelected = next
    }
    const { rerender } = render(
      <FoodSlotPicker slots={slots} selected={currentSelected} onChange={onChange} />
    )

    const button = screen.getByRole('button', { name: 'Breakfast day 1' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)
    expect(currentSelected).toEqual(['b1'])

    // Rerender with updated selected
    rerender(<FoodSlotPicker slots={slots} selected={currentSelected} onChange={onChange} />)
    expect(button).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(button)
    expect(currentSelected).toEqual([])
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

    // Click again to deselect all breakfast
    fireEvent.click(everyBreakfastBtn)
    expect(currentSelected).toEqual([])
  })

  it('deselects individual slot when whole-meal is on', () => {
    const slots = [
      slot('b1', 1, 'breakfast'),
      slot('b2', 2, 'breakfast'),
    ]
    const selected = ['b1', 'b2']
    render(<FoodSlotPicker slots={slots} selected={selected} onChange={() => {}} />)

    const dayOneBreakfast = screen.getByRole('button', { name: 'Breakfast day 1' })
    const dayTwoBreakfast = screen.getByRole('button', { name: 'Breakfast day 2' })

    expect(dayOneBreakfast).toHaveAttribute('aria-pressed', 'true')
    expect(dayTwoBreakfast).toHaveAttribute('aria-pressed', 'true')

    // The whole-meal button should also be on
    const everyBreakfastBtn = screen.getByRole('button', { name: 'Every breakfast' })
    expect(everyBreakfastBtn).toHaveAttribute('aria-pressed', 'true')
  })
})
