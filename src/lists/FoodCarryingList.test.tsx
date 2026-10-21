// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FoodCarryingList from './FoodCarryingList'
import { FOOD_QUANTITY_MAX, type FoodItemResponse } from '../../shared/food'

afterEach(cleanup)

function item(over: Partial<FoodItemResponse> & { id: string; name: string }): FoodItemResponse {
  return {
    weightGrams: 100,
    quantity: 1,
    // Per-meal is the app default; unitCount is what the row RENDERS, and
    // tests that care about the derivation set both explicitly.
    isPerMeal: true,
    unitCount: 1,
    sortOrder: 0,
    isPacked: false,
    isReady: false,
    packingLocationId: null,
    packSortOrder: 0,
    slotIds: [],
    ...over,
  }
}

// One scheduled item (Ramen, 85 g), one unscheduled item (Trail mix, 240 g).
// 85 + 240 = 325 g, used by the totals-row test below.
const DEFAULT_ITEMS: FoodItemResponse[] = [
  item({ id: 'r1', name: 'Ramen', weightGrams: 85, quantity: 1, slotIds: ['s1'] }),
  item({ id: 't1', name: 'Trail mix', weightGrams: 240, quantity: 1, slotIds: [] }),
]

function renderList(overrides: {
  items?: readonly FoodItemResponse[]
  busy?: boolean
  onReschedule?: (itemId: string) => void
  onSetQuantity?: (itemId: string, quantity: number) => void
  onTogglePerMeal?: (itemId: string, isPerMeal: boolean) => void
  onDelete?: (itemId: string) => void
} = {}) {
  const props = {
    items: overrides.items ?? DEFAULT_ITEMS,
    weightUnit: 'g' as const,
    busy: overrides.busy ?? false,
    onReschedule: overrides.onReschedule ?? vi.fn(),
    onSetQuantity: overrides.onSetQuantity ?? vi.fn(),
    onTogglePerMeal: overrides.onTogglePerMeal ?? vi.fn(),
    onDelete: overrides.onDelete ?? vi.fn(),
  }
  render(<FoodCarryingList {...props} />)
  return props
}

describe('FoodCarryingList schedule affordance', () => {
  it('makes the meals count itself the schedule button; unscheduled rows say Schedule', () => {
    // One affordance where there used to be two: the meals count was plain
    // text NEXT TO a wide "Reschedule" text button, which crowded the row
    // off the right edge at phone width.
    renderList()
    const ramenRow = screen.getByText('Ramen').closest('div')!
    const trailMixRow = screen.getByText('Trail mix').closest('div')!
    expect(
      within(ramenRow).getByRole('button', { name: 'Reschedule Ramen' }),
    ).toHaveTextContent('1 meal')
    expect(
      within(trailMixRow).getByRole('button', { name: 'Schedule Trail mix' }),
    ).toBeInTheDocument()
  })

  it('calls onReschedule with the item id', async () => {
    const user = userEvent.setup()
    const props = renderList()
    const trailMixRow = screen.getByText('Trail mix').closest('div')!
    await user.click(within(trailMixRow).getByRole('button', { name: 'Schedule Trail mix' }))
    expect(props.onReschedule).toHaveBeenCalledWith('t1')
  })
})

describe('FoodCarryingList per-meal', () => {
  // The row has to SAY the arithmetic, because the bug it replaces was the app
  // doing none and the user having no way to tell.
  it('shows what a per-meal item adds up to across its meals', () => {
    renderList({
      items: [
        item({
          id: 'i1',
          name: 'Justin\'s PB',
          weightGrams: 33.5,
          quantity: 1,
          isPerMeal: true,
          unitCount: 5,
          slotIds: ['s1', 's2', 's3', 's4', 's5'],
        }),
      ],
    })
    const row = screen.getByText("Justin's PB").closest('div')!
    expect(within(row).getByText('per meal')).toBeInTheDocument()
    expect(within(row).getByText('5 meals')).toBeInTheDocument()
    expect(within(row).getByText('= 5 carried')).toBeInTheDocument()
    // The weight column is what it adds to the PACK: 33.5 x 5.
    expect(within(row).getByLabelText('167.5 g')).toBeInTheDocument()
  })

  it('omits the total when it equals the count, rather than printing "= 1"', () => {
    renderList({
      items: [
        item({
          id: 'i1',
          name: 'Trail mix',
          weightGrams: 500,
          quantity: 1,
          isPerMeal: false,
          unitCount: 1,
          slotIds: ['s1', 's2'],
        }),
      ],
    })
    const row = screen.getByText('Trail mix').closest('div')!
    expect(within(row).getByText('shared stash')).toBeInTheDocument()
    expect(within(row).queryByText(/= 1/)).not.toBeInTheDocument()
    // One bag, whatever the schedule says.
    expect(within(row).getByLabelText('500 g')).toBeInTheDocument()
  })

  it('toggles the mode from the row', async () => {
    const user = userEvent.setup()
    const props = renderList({
      items: [
        item({ id: 'i1', name: 'Bar', quantity: 1, isPerMeal: true, unitCount: 3 }),
      ],
    })

    await user.click(screen.getByRole('button', { name: /Bar is per meal/ }))

    expect(props.onTogglePerMeal).toHaveBeenCalledWith('i1', false)
  })

  it('cannot be toggled while a food write is in flight', () => {
    renderList({
      busy: true,
      items: [
        item({ id: 'i1', name: 'Bar', quantity: 1, isPerMeal: true, unitCount: 3 }),
      ],
    })
    expect(
      (screen.getByRole('button', { name: /Bar is per meal/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})

describe('FoodCarryingList quantity', () => {
  // The count is always shown and always editable, even at 1. Hiding "1 x"
  // as noise would leave an item created at the default with nothing on
  // screen to say so and nothing to click, so a plan of five lunches would
  // report one packet in the pack total. FoodView.test.tsx "patches only the
  // quantity" edits a count of 1 through this control.
  it('clamps a quantity past the server ceiling instead of sending it', async () => {
    const user = userEvent.setup()
    const props = renderList({
      items: [item({ id: 'i1', name: 'Jerky', weightGrams: 90, quantity: 1, slotIds: [] })],
    })

    await user.click(screen.getByRole('button', { name: 'Edit quantity 1 for Jerky' }))
    await user.keyboard('99999{Enter}')

    expect(props.onSetQuantity).toHaveBeenCalledWith('i1', FOOD_QUANTITY_MAX)
  })

  it('is read-only while a food write is in flight', () => {
    renderList({
      busy: true,
      items: [item({ id: 'i1', name: 'Jerky', weightGrams: 90, quantity: 2, slotIds: [] })],
    })
    expect(
      screen.queryByRole('button', { name: 'Edit quantity 2 for Jerky' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})

describe('FoodCarryingList single list with badge', () => {
  it('renders one list with an Unscheduled badge instead of a duplicate section', () => {
    renderList() // one scheduled, one unscheduled item
    expect(screen.getAllByText('Ramen')).toHaveLength(1)
    const unscheduledRow = screen.getByText('Trail mix').closest('div')!
    expect(within(unscheduledRow).getByText('Unscheduled')).toBeInTheDocument()
    expect(screen.queryByText('Any time')).not.toBeInTheDocument()
  })
})

describe('FoodCarryingList totals row', () => {
  it('closes with an item count and total weight', () => {
    renderList() // 85 g + 240 g
    expect(screen.getByText('2 items')).toBeInTheDocument()
    expect(screen.getByLabelText('325 g')).toBeInTheDocument()
  })

  it('uses the singular for exactly one item', () => {
    renderList({ items: [item({ id: 'i1', name: 'Jerky', weightGrams: 90 })] })
    expect(screen.getByText('1 item')).toBeInTheDocument()
  })
})

describe('FoodCarryingList busy', () => {
  it('disables reschedule and delete controls while busy', () => {
    renderList({ busy: true })
    expect(screen.getByRole('button', { name: 'Reschedule Ramen' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Schedule Trail mix' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove Ramen' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove Trail mix' })).toBeDisabled()
  })
})
