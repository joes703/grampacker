// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import FoodSection from './FoodSection'
import type { ListFoodResponse } from '../../shared/food'

afterEach(cleanup)

const slot = (id: string, dayNumber: number, meal: 'breakfast' | 'lunch' | 'dinner', needed = true) =>
  ({ id, dayNumber, meal, needed })

const baseProps = {
  weightUnit: 'g' as const,
  busy: false,
  onSetDays: vi.fn(),
  onSetSlotNeeded: vi.fn(),
  onAddItem: vi.fn(),
  onDeleteItem: vi.fn(),
}

function renderSection(food: ListFoodResponse, overrides = {}) {
  const props = { ...baseProps, ...overrides, food }
  render(<FoodSection {...props} />)
  return props
}

describe('FoodSection slot states', () => {
  // The three states must stay distinguishable. A blank that could mean either
  // "I skipped this on purpose" or "I forgot" defeats the whole feature.
  const food: ListFoodResponse = {
    dayCount: 1,
    slots: [
      slot('s1', 1, 'breakfast', false),
      slot('s2', 1, 'lunch'),
      slot('s3', 1, 'dinner'),
    ],
    items: [
      { id: 'i1', name: 'Ramen', weightGrams: 120, quantity: 1, sortOrder: 0, slotIds: ['s3'] },
    ],
  }

  it('distinguishes not-needed, empty and filled', () => {
    renderSection(food)
    // Twice: the slot's own label, and the button offering to undo it.
    expect(screen.getAllByText('Not needed').length).toBeGreaterThan(0)
    // The omission check: an expected meal with nothing in it must read as
    // unfinished, not as a blank.
    expect(screen.getByText('Nothing yet')).toBeInTheDocument()
    // Twice by design: named in the dinner slot it fills, and again in the
    // Carrying list where its weight and remove control live.
    expect(screen.getAllByText('Ramen')).toHaveLength(2)
  })

  it('never claims a filled slot is complete', () => {
    // A breakfast holding only coffee is non-empty and not necessarily enough.
    renderSection(food)
    expect(screen.queryByLabelText(/complete/i)).toBeNull()
    expect(screen.queryByText(/✓/)).toBeNull()
  })

  it('derives the meal counts and offers no way to type them', () => {
    renderSection(food)
    // Two needed meals remain of the three generated.
    expect(screen.getByText(/1 lunch · 1 dinner/)).toBeInTheDocument()
    const numbers = screen.getAllByRole('spinbutton')
    expect(numbers.map((n) => n.getAttribute('aria-label'))).toEqual([
      'Trip length in days',
    ])
  })
})

describe('FoodSection weight', () => {
  it('shows an item carried across many meals at its own weight', () => {
    // One 500 g bag eaten across five lunches is 500 g on the row, not 2500.
    renderSection({
      dayCount: 5,
      slots: [1, 2, 3, 4, 5].map((d) => slot(`l${d}`, d, 'lunch')),
      items: [
        {
          id: 'i1',
          name: 'Trail mix',
          weightGrams: 500,
          quantity: 1,
          sortOrder: 0,
          slotIds: ['l1', 'l2', 'l3', 'l4', 'l5'],
        },
      ],
    })
    // ItemWeightValue splits the number from the unit, so match on content.
    const body = document.body.textContent ?? ''
    expect(body).toContain('500')
    expect(body).not.toContain('2500')
    expect(screen.getByText('5 meals')).toBeInTheDocument()
  })
})

describe('FoodSection add form', () => {
  const food: ListFoodResponse = {
    dayCount: 4,
    slots: [1, 2, 3, 4].map((d) => slot(`b${d}`, d, 'breakfast')),
    items: [],
  }

  it('defaults quantity to 1 even when every breakfast is selected', () => {
    // The bug this feature keeps trying to grow back: defaulting quantity to
    // the slot count would make one shared bag weigh four times too much.
    const props = renderSection(food)
    fireEvent.click(screen.getByRole('button', { name: '+ Add food' }))
    fireEvent.change(screen.getByLabelText('Food name'), { target: { value: 'Oatmeal' } })
    fireEvent.change(screen.getByLabelText('Weight in grams'), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: 'Every breakfast' }))

    expect(screen.getByLabelText('Units carried')).toHaveValue(1)

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(props.onAddItem).toHaveBeenCalledWith({
      name: 'Oatmeal',
      weightGrams: 80,
      quantity: 1,
      slotIds: ['b1', 'b2', 'b3', 'b4'],
    })
  })

  it('warns that food here adds to consumable gear', () => {
    // Anyone keeping a "Food bag" gear row would otherwise double-count.
    renderSection(food)
    expect(screen.getByText(/not counted twice/i)).toBeInTheDocument()
  })
})

describe('FoodSection empty state', () => {
  it('explains what setting a trip length does', () => {
    renderSection({ dayCount: 0, slots: [], items: [] })
    expect(screen.getByText(/Strike the ones you will not/)).toBeInTheDocument()
  })
})
