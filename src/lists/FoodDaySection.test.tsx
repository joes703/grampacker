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
  onEditItem: vi.fn(),
}

function renderDay(overrides: {
  slots?: readonly FoodSlotResponse[]
  itemsBySlot?: ReadonlyMap<string, FoodItemResponse[]>
} = {}) {
  const slots = overrides.slots ?? DEFAULT_SLOTS
  const itemsBySlot =
    overrides.itemsBySlot ??
    new Map([['l1', [item({ id: 'i1', name: 'Trail mix', weightGrams: 120, quantity: 2 })]]])
  const props = { ...baseProps, onAddToSlots: vi.fn(), onEditItem: vi.fn(), slots, itemsBySlot }
  render(<FoodDaySection {...props} />)
  return props
}

const mealGroup = (name: string) => screen.getByRole('group', { name })

describe('FoodDaySection empty treatment', () => {
  // Three full-height "+ Add" rows and a "total 0 g" for every unplanned day
  // would be a wall of identical rows that drowns out the days that ARE
  // planned.
  it('collapses a day with nothing planned to one line, with no day total', async () => {
    const user = userEvent.setup()
    const props = renderDay({ itemsBySlot: new Map() })
    expect(screen.getByText('Nothing planned')).toBeInTheDocument()
    expect(screen.queryByText('Total')).not.toBeInTheDocument()
    expect(screen.queryByText('Breakfast')).not.toBeInTheDocument()

    // The collapsed add preselects every meal of the day; the dialog's grid
    // is where the user narrows it.
    await user.click(screen.getByRole('button', { name: 'Add food for day 1' }))
    expect(props.onAddToSlots).toHaveBeenCalledWith(['b1', 'l1', 'd1'])
  })

  it('keeps the meal lines of a partly planned day; an empty slot adds to itself', async () => {
    const user = userEvent.setup()
    const props = renderDay() // lunch holds Trail mix; breakfast and dinner are empty
    expect(screen.getByText('Total')).toBeInTheDocument()
    await user.click(
      within(mealGroup('Breakfast day 1')).getByRole('button', { name: /add/i }),
    )
    expect(props.onAddToSlots).toHaveBeenCalledWith(['b1'])
  })
})

describe('FoodDaySection food lines', () => {
  it('shows each food with quantity and weight in the Qty and Weight columns', () => {
    renderDay() // lunch holds Trail mix, 120 g x 2
    const lunch = mealGroup('Lunch day 1')
    expect(within(lunch).getByText('Trail mix')).toBeInTheDocument()
    expect(within(lunch).getByText('2')).toBeInTheDocument()
    expect(within(lunch).getByLabelText('240 g')).toBeInTheDocument()
    // The header carries the column labels, like a category table's.
    expect(screen.getByText('Qty')).toBeInTheDocument()
    expect(screen.getByText('Weight')).toBeInTheDocument()
  })

  it('every food line is a button that opens the editor for that item', async () => {
    const user = userEvent.setup()
    const props = renderDay()
    await user.click(screen.getByRole('button', { name: 'Edit Trail mix' }))
    expect(props.onEditItem).toHaveBeenCalledWith('i1')
  })

  it('tags a shared stash "one container"; a per-meal item carries no tag', () => {
    renderDay({
      itemsBySlot: new Map([
        [
          'l1',
          [
            item({ id: 'i1', name: 'Peanut butter', weightGrams: 350, isPerMeal: false }),
            item({ id: 'i2', name: 'Jerky', weightGrams: 90 }),
          ],
        ],
      ]),
    })
    const pb = screen.getByRole('button', { name: 'Edit Peanut butter' })
    expect(within(pb).getByText('one container')).toBeInTheDocument()
    const jerky = screen.getByRole('button', { name: 'Edit Jerky' })
    expect(within(jerky).queryByText('one container')).not.toBeInTheDocument()
  })

  it('shows the Qty cell even for a single unit - a column is all or nothing', () => {
    // The old layout hid a "× 1" chip as noise. In a labeled Qty column an
    // empty cell reads as missing data, so the count always renders, as it
    // does on every other table.
    renderDay({
      itemsBySlot: new Map([
        ['l1', [item({ id: 'i1', name: 'Jerky', weightGrams: 90, quantity: 1 })]],
      ]),
    })
    const jerky = within(mealGroup('Lunch day 1')).getByRole('button', { name: 'Edit Jerky' })
    expect(within(jerky).getByText('1')).toBeInTheDocument()
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
    // 240 g (trail mix) + 100 g (jerky) = 340 g subtotal, via foodGramsAtOneMeal.
    expect(within(mealGroup('Lunch day 1')).getByLabelText('340 g')).toBeInTheDocument()
  })

  it('omits the subtotal for a single food - it would repeat the line below', () => {
    // The mock drew a subtotal on every non-empty meal; this is the one
    // deliberate deviation, per the owner's "no copied-over data" rule for
    // derived numbers.
    renderDay() // lunch holds only Trail mix, at 240 g
    expect(within(mealGroup('Lunch day 1')).getAllByLabelText(/ g$/)).toHaveLength(1)
  })
})

describe('FoodDaySection day total', () => {
  // The day total's dedupe is CONDITIONAL, and these two tests are
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
    const totalRow = screen.getByText('Total').closest('div')!
    expect(within(totalRow).getByLabelText('500 g')).toBeInTheDocument()
    expect(screen.queryByLabelText('1000 g')).not.toBeInTheDocument()
  })

  it('counts a PER-MEAL item once for every meal of the day it is in', () => {
    // One bar at breakfast and another at lunch is two bars. Deduping this
    // to one would under-report the day.
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
    const totalRow = screen.getByText('Total').closest('div')!
    expect(within(totalRow).getByLabelText('1000 g')).toBeInTheDocument()
  })

  it('shows a day over a pound as compound lb + oz, like every other total', () => {
    // The day total is an aggregate, so in imperial it uses the compound
    // lb+oz form the category footers and Weight summary use - not the
    // plain-ounce form of a single row. 500 g is 17.6 oz, past the 16 oz
    // threshold where the compound form kicks in.
    const heavy = item({ id: 'heavy', name: 'Dinner bag', weightGrams: 500 })
    render(
      <FoodDaySection
        {...baseProps}
        weightUnit="oz"
        slots={DEFAULT_SLOTS}
        itemsBySlot={new Map([['d1', [heavy]]])}
      />,
    )
    const totalRow = screen.getByText('Total').closest('div')!
    expect(within(totalRow).getByLabelText('1 lb 1.6 oz')).toBeInTheDocument()
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
