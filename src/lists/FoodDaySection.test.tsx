// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FoodDaySection from './FoodDaySection'
import type { FoodItemResponse, FoodSlotResponse } from '../../shared/food'

afterEach(cleanup)

const slot = (
  id: string,
  meal: FoodSlotResponse['meal'],
  dayNumber = 1,
): FoodSlotResponse => ({ id, dayNumber, meal })

const item = (
  over: Partial<FoodItemResponse> & { id: string; name: string },
): FoodItemResponse => ({
  weightGrams: 100,
  quantity: 1,
  // This section shows an item WITHIN one meal, so it renders quantity (how
  // many at this sitting), never unitCount (how many across the trip).
  isPerMeal: true,
  unitCount: 1,
  sortOrder: 0,
  isPacked: false,
  isReady: false,
  packingLocationId: null,
  packSortOrder: 0,
  slotIds: [],
  ...over,
})

const DEFAULT_SLOTS: FoodSlotResponse[] = [
  slot('b1', 'breakfast'),
  slot('l1', 'lunch'),
  slot('d1', 'dinner'),
]

const baseProps = {
  day: 1,
  weightUnit: 'g' as const,
  busy: false,
  onAddToSlots: vi.fn(),
}

function renderDay(overrides: {
  slots?: readonly FoodSlotResponse[]
  itemsBySlot?: ReadonlyMap<string, FoodItemResponse[]>
} = {}) {
  const slots = overrides.slots ?? DEFAULT_SLOTS
  const itemsBySlot =
    overrides.itemsBySlot ??
    new Map([['l1', [item({ id: 'i1', name: 'Trail mix', weightGrams: 120, quantity: 2 })]]])
  const props = { ...baseProps, onAddToSlots: vi.fn(), slots, itemsBySlot }
  render(<FoodDaySection {...props} />)
  return props
}

describe('FoodDaySection empty treatment', () => {
  // An unplanned trip used to render three full-height "+ Add" rows and a
  // "Day total 0 g" for every day - a wall of identical rows that drowned
  // out the days that ARE planned.
  it('collapses a day with nothing planned to one line, with no day total', async () => {
    const user = userEvent.setup()
    const props = renderDay({ itemsBySlot: new Map() })
    expect(screen.getByText('Nothing planned')).toBeInTheDocument()
    expect(screen.queryByText('Day total')).not.toBeInTheDocument()
    expect(screen.queryByText('Breakfast')).not.toBeInTheDocument()

    // The collapsed add preselects every meal of the day; the form's picker
    // is where the user narrows it.
    await user.click(screen.getByRole('button', { name: 'Add food for day 1' }))
    expect(props.onAddToSlots).toHaveBeenCalledWith(['b1', 'l1', 'd1'])
  })

  it('keeps the meal rows of a partly planned day; an empty slot adds to itself', async () => {
    const user = userEvent.setup()
    const props = renderDay() // lunch holds Trail mix; breakfast and dinner are empty
    expect(screen.getByText('Day total')).toBeInTheDocument()
    const breakfast = screen.getByText('Breakfast').closest('div')!
    await user.click(within(breakfast).getByRole('button', { name: /add/i }))
    expect(props.onAddToSlots).toHaveBeenCalledWith(['b1'])
  })
})

describe('FoodDaySection food lines', () => {
  it('shows each food with quantity and weight inline', () => {
    renderDay() // lunch holds Trail mix, 120 g x 2
    const lunch = screen.getByText('Lunch').closest('div')!
    expect(within(lunch).getByText('Trail mix')).toBeInTheDocument()
    expect(within(lunch).getByText('× 2')).toBeInTheDocument()
    expect(within(lunch).getByLabelText('240 g')).toBeInTheDocument()
  })

  it('omits the × qty tag for a single carried unit', () => {
    renderDay({
      itemsBySlot: new Map([
        ['l1', [item({ id: 'i1', name: 'Jerky', weightGrams: 90, quantity: 1 })]],
      ]),
    })
    const lunch = screen.getByText('Lunch').closest('div')!
    expect(within(lunch).queryByText('× 1')).not.toBeInTheDocument()
  })

  it('shows a meal subtotal only when the slot holds two or more foods', () => {
    renderDay({
      itemsBySlot: new Map([
        [
          'l1',
          [
            item({ id: 'i1', name: 'Trail mix', weightGrams: 120, quantity: 2 }),
            item({ id: 'i2', name: 'Jerky', weightGrams: 100, quantity: 1 }),
          ],
        ],
      ]),
    })
    const lunch = screen.getByText('Lunch').closest('div')!
    // 240 g (trail mix) + 100 g (jerky) = 340 g subtotal, via foodGramsFor.
    expect(within(lunch).getByLabelText('340 g')).toBeInTheDocument()
  })

  it('omits the subtotal line for a single food', () => {
    renderDay() // lunch holds only Trail mix, at 240 g
    const lunch = screen.getByText('Lunch').closest('div')!
    // Only one weight value should appear: the food's own line, no subtotal.
    expect(within(lunch).getAllByLabelText(/ g$/)).toHaveLength(1)
  })
})

describe('FoodDaySection day total', () => {
  // The day total's dedupe is CONDITIONAL since 0024, and these two tests are
  // the whole difference. Getting this wrong in either direction is a wrong
  // pack weight: dedupe everything and a per-meal item under-reports, dedupe
  // nothing and a shared bag is counted once per meal it is picked at.
  it('counts a SHARED stash once however many of the day it spans', () => {
    const shared = item({
      id: 'shared',
      name: 'Trail mix',
      weightGrams: 500,
      quantity: 1,
      isPerMeal: false,
    })
    renderDay({
      itemsBySlot: new Map([
        ['b1', [shared]],
        ['l1', [shared]],
      ]),
    })
    const totalRow = screen.getByText('Day total').closest('div')!
    expect(within(totalRow).getByLabelText('500 g')).toBeInTheDocument()
    expect(screen.queryByLabelText('1000 g')).not.toBeInTheDocument()
  })

  it('counts a PER-MEAL item once for every meal of the day it is in', () => {
    // One bar at breakfast and another at lunch is two bars. The old code
    // deduped this to one, which is the under-report 0024 exists to end.
    const perMeal = item({
      id: 'bar',
      name: 'Bar',
      weightGrams: 500,
      quantity: 1,
      isPerMeal: true,
    })
    renderDay({
      itemsBySlot: new Map([
        ['b1', [perMeal]],
        ['l1', [perMeal]],
      ]),
    })
    const totalRow = screen.getByText('Day total').closest('div')!
    expect(within(totalRow).getByLabelText('1000 g')).toBeInTheDocument()
  })
})

describe('FoodDaySection has no plan-completeness opinion', () => {
  it('never claims a filled slot is complete', () => {
    // A breakfast holding only coffee is non-empty and not necessarily
    // enough - there is deliberately no "complete" tick on a filled slot;
    // judging that is the user's job, not the app's.
    renderDay()
    expect(screen.queryByLabelText(/complete/i)).toBeNull()
    expect(screen.queryByText(/✓/)).toBeNull()
  })
})
