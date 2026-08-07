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
  needed = true,
  dayNumber = 1,
): FoodSlotResponse => ({ id, dayNumber, meal, needed })

const item = (
  over: Partial<FoodItemResponse> & { id: string; name: string },
): FoodItemResponse => ({
  weightGrams: 100,
  quantity: 1,
  sortOrder: 0,
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
  onSetSlotNeeded: vi.fn(),
  onAddToSlot: vi.fn(),
}

function renderDay(overrides: {
  slots?: readonly FoodSlotResponse[]
  itemsBySlot?: ReadonlyMap<string, FoodItemResponse[]>
} = {}) {
  const slots = overrides.slots ?? DEFAULT_SLOTS
  const itemsBySlot =
    overrides.itemsBySlot ??
    new Map([['l1', [item({ id: 'i1', name: 'Trail mix', weightGrams: 120, quantity: 2 })]]])
  const props = { ...baseProps, slots, itemsBySlot }
  render(<FoodDaySection {...props} />)
  return props
}

function dinnerRow() {
  return screen.getByText('Dinner').closest('div')!
}

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
  it('totals the day counting a twice-scheduled item once', () => {
    // Same item id scheduled at both breakfast AND lunch of this day - the
    // exact inflation foodGramsFor's comment warns about (weight-breakdown.ts).
    const shared = item({ id: 'shared', name: 'Trail mix', weightGrams: 500, quantity: 1 })
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
})

describe('FoodDaySection empty slot', () => {
  it('offers + Add on an empty needed slot, preselecting it', async () => {
    const user = userEvent.setup()
    const props = renderDay()
    await user.click(within(dinnerRow()).getByRole('button', { name: /add/i }))
    expect(props.onAddToSlot).toHaveBeenCalledWith('d1')
  })

  it('marks an empty needed slot with the omission badge', () => {
    renderDay()
    expect(within(dinnerRow()).getByText('Nothing planned')).toBeInTheDocument()
  })
})

describe('FoodDaySection skip / restore', () => {
  it('reads Skip and Restore, not the old labels', () => {
    renderDay()
    expect(screen.getAllByRole('button', { name: 'Skip' }).length).toBeGreaterThan(0)
    expect(screen.queryByText('Not needed')).not.toBeInTheDocument()
    expect(screen.queryByText('Need it')).not.toBeInTheDocument()
  })

  it('confirms with the moved, reworded copy before unscheduling a filled slot', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const props = renderDay()
    const lunch = screen.getByText('Lunch').closest('div')!
    await user.click(within(lunch).getByRole('button', { name: 'Skip' }))

    expect(confirmSpy).toHaveBeenCalledWith(
      'Lunch on day 1 has food planned for it. Skipping it unschedules that ' +
        'food - it stays on the list and still counts toward your pack ' +
        'weight. Continue?',
    )
    expect(props.onSetSlotNeeded).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('does not confirm when skipping an empty slot', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm')
    const props = renderDay()
    await user.click(within(dinnerRow()).getByRole('button', { name: 'Skip' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(props.onSetSlotNeeded).toHaveBeenCalledWith('d1', false)
    confirmSpy.mockRestore()
  })

  it('restores a skipped slot without confirming', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm')
    const props = renderDay({
      slots: [slot('b1', 'breakfast', false), slot('l1', 'lunch'), slot('d1', 'dinner')],
    })
    await user.click(screen.getByRole('button', { name: 'Restore' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(props.onSetSlotNeeded).toHaveBeenCalledWith('b1', true)
    confirmSpy.mockRestore()
  })
})

describe('FoodDaySection three states', () => {
  it('renders skipped, empty and filled distinguishably', () => {
    renderDay({
      slots: [slot('b1', 'breakfast', false), slot('l1', 'lunch'), slot('d1', 'dinner')],
    })
    expect(screen.getByText('Skipped')).toBeInTheDocument()
    expect(screen.getByText('Breakfast')).toHaveClass('line-through')
    expect(screen.getByText('Nothing planned')).toBeInTheDocument()
    expect(screen.getByText('Trail mix')).toBeInTheDocument()
  })

  it('never claims a filled slot is complete', () => {
    // A breakfast holding only coffee is non-empty and not necessarily
    // enough - there is deliberately no "complete" tick on a filled slot;
    // judging that is the user's job, not the app's.
    renderDay({
      slots: [slot('b1', 'breakfast', false), slot('l1', 'lunch'), slot('d1', 'dinner')],
    })
    expect(screen.queryByLabelText(/complete/i)).toBeNull()
    expect(screen.queryByText(/✓/)).toBeNull()
  })
})
