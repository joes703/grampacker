// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FOOD_ITEM_CAP, type ListFoodResponse } from '../../shared/food'
import { ApiError } from '../lib/api'

// FoodView owns the food query's own three-state gate (AGENTS.md), separate
// from ListDetailPage's detail-data composite. This file pins that gate in
// isolation - ListDetailPage.food.test.tsx pins where FoodView is mounted
// and that a sibling detail-query failure does not reach it.
//
// It also owns every food mutation (Task 12: the old flat food layout
// retired, its state and JSX moved here as FoodDocument, composed from
// FoodDaySection, AddFoodForm, FoodCarryingList and FoodSlotPicker).
// Rendering detail already covered at the component level - slot three-states
// and weight totals
// (FoodDaySection.test.tsx), the carrying list and its schedule affordance
// (FoodCarryingList.test.tsx), and the add form's own validation/preview/busy
// behavior (AddFoodForm.test.tsx) - is NOT re-asserted here. This file proves
// the composition: which data reaches which component, the days-input
// destructive guards (unique to this view), and the exact mutation contract
// (toast text, argument shapes, success-only close, busy propagation).

const h = vi.hoisted(() => ({
  fetchListFood: vi.fn(),
  setFoodDays: vi.fn(),
  setFoodSlotNeeded: vi.fn(),
  createFoodItem: vi.fn(),
  updateFoodItem: vi.fn(),
  deleteFoodItem: vi.fn(),
}))
const toastMock = vi.hoisted(() => ({ showToast: vi.fn() }))

vi.mock('../lib/queries/food', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries/food')>()
  return { ...actual, ...h }
})
vi.mock('../lib/toast', () => toastMock)

const listId = 'list-1'
const user = userEvent.setup()

const food: ListFoodResponse = {
  dayCount: 3,
  slots: [{ id: 'slot-1', dayNumber: 1, meal: 'breakfast', needed: true }],
  items: [],
} as unknown as ListFoodResponse

// One day, every meal needed, nothing scheduled - the fixture the "+ Add"
// tests need so the dinner slot renders its own "+ Add" affordance.
const oneDayFood: ListFoodResponse = {
  dayCount: 1,
  slots: [
    { id: 'b1', dayNumber: 1, meal: 'breakfast', needed: true },
    { id: 'l1', dayNumber: 1, meal: 'lunch', needed: true },
    { id: 'd1', dayNumber: 1, meal: 'dinner', needed: true },
  ],
  items: [],
}

// The old destructive-guards fixture, carried over: day 1 breakfast
// is empty (untouched, no work to lose), day 3 lunch holds Ramen (the one
// slot a shortening below day 3 would actually cost).
const guardFood: ListFoodResponse = {
  dayCount: 3,
  slots: [
    { id: 'b1', dayNumber: 1, meal: 'breakfast', needed: true },
    { id: 'l3', dayNumber: 3, meal: 'lunch', needed: true },
  ],
  items: [{ id: 'i1', name: 'Ramen', weightGrams: 120, quantity: 1, sortOrder: 0, slotIds: ['l3'] }],
}

const rescheduleFood: ListFoodResponse = {
  dayCount: 2,
  slots: [
    { id: 'b1', dayNumber: 1, meal: 'breakfast', needed: true },
    { id: 'd2', dayNumber: 2, meal: 'dinner', needed: true },
  ],
  items: [{ id: 'i1', name: 'Ramen', weightGrams: 120, quantity: 1, sortOrder: 0, slotIds: ['b1'] }],
}

function renderFoodView() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return import('./FoodView').then(({ default: FoodView }) =>
    render(
      <QueryClientProvider client={qc}>
        <FoodView listId={listId} />
      </QueryClientProvider>,
    ),
  )
}

// Scoped to the day-grid's own "Day 1" region: once the add form is open its
// FoodSlotPicker renders its own "Dinner" toggle too, and a bare
// screen.findByText('Dinner') would then match both.
async function findDinnerRow() {
  const daySection = await screen.findByRole('region', { name: 'Day 1' })
  return within(daySection).getByText('Dinner').closest('div') as HTMLElement
}

beforeEach(() => {
  h.fetchListFood.mockResolvedValue(food)
  h.setFoodDays.mockResolvedValue(food)
  h.setFoodSlotNeeded.mockResolvedValue(food)
  h.createFoodItem.mockResolvedValue({
    id: 'new-item',
    name: 'Oatmeal',
    weightGrams: 80,
    quantity: 1,
    sortOrder: 0,
    slotIds: [],
  })
  h.updateFoodItem.mockResolvedValue({
    id: 'i1',
    name: 'Ramen',
    weightGrams: 120,
    quantity: 1,
    sortOrder: 0,
    slotIds: [],
  })
  h.deleteFoodItem.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FoodView query gate', () => {
  it('shows a loading state before live controls', async () => {
    let release: (value: ListFoodResponse) => void = () => {}
    h.fetchListFood.mockReturnValue(
      new Promise<ListFoodResponse>((resolve) => {
        release = resolve
      }),
    )

    await renderFoodView()
    expect(await screen.findByText('Loading food…')).toBeTruthy()
    expect(screen.queryByLabelText('Trip length in days')).not.toBeInTheDocument()

    release(food)
    expect(await screen.findByLabelText('Trip length in days')).toBeInTheDocument()
  })

  it('shows retry, not live controls, when the food read fails', async () => {
    h.fetchListFood.mockRejectedValue(new Error('offline'))

    await renderFoodView()
    expect(await screen.findByText("Couldn't load the food plan.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Trip length in days')).not.toBeInTheDocument()
  })

  it('renders live controls once the food read resolves', async () => {
    await renderFoodView()
    const days = await screen.findByLabelText('Trip length in days')
    expect((days as HTMLInputElement).disabled).toBe(false)
    expect((days as HTMLInputElement).value).toBe('3')
  })
})

describe('FoodView header', () => {
  it('shows the explainer line', async () => {
    await renderFoodView()
    expect(
      await screen.findByText("Skip meals you'll eat in town or on the road."),
    ).toBeInTheDocument()
  })
})

describe('FoodView empty state', () => {
  it('explains what setting a trip length does when there are zero days', async () => {
    h.fetchListFood.mockResolvedValue({ dayCount: 0, slots: [], items: [] })
    await renderFoodView()
    expect(await screen.findByText(/Strike the ones you will not/)).toBeInTheDocument()
  })
})

describe('FoodView days-input destructive guards', () => {
  it('treats an emptied day field as a typo, not as zero days', async () => {
    // Number('') is 0, and 0 days deletes every slot on the list. Clearing the
    // box to retype it must not wipe the trip.
    h.fetchListFood.mockResolvedValue(guardFood)
    await renderFoodView()
    const input = await screen.findByLabelText('Trip length in days')
    await user.clear(input)
    await user.tab()

    expect(h.setFoodDays).not.toHaveBeenCalled()
    expect(input).toHaveValue(3)
  })

  it('reverts an out-of-range value instead of committing it', async () => {
    h.fetchListFood.mockResolvedValue(guardFood)
    await renderFoodView()
    const input = await screen.findByLabelText('Trip length in days')
    await user.clear(input)
    await user.type(input, '31')
    await user.tab()

    expect(h.setFoodDays).not.toHaveBeenCalled()
    expect(input).toHaveValue(3)
  })

  it('asks before a shortening that would drop planned meals', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    h.fetchListFood.mockResolvedValue(guardFood)
    await renderFoodView()
    const input = await screen.findByLabelText('Trip length in days')
    await user.clear(input)
    await user.type(input, '2')
    await user.tab()

    expect(confirmSpy).toHaveBeenCalled()
    expect(h.setFoodDays).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('shortens without asking when nothing would be lost', async () => {
    // Day 3 holds the only planned food; trimming a 4-day trip to 3 loses
    // nothing.
    const confirmSpy = vi.spyOn(window, 'confirm')
    h.fetchListFood.mockResolvedValue({ ...guardFood, dayCount: 4 })
    await renderFoodView()
    const input = await screen.findByLabelText('Trip length in days')
    await user.clear(input)
    await user.type(input, '3')
    await user.tab()

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(h.setFoodDays).toHaveBeenCalledWith(listId, 3)
    confirmSpy.mockRestore()
  })
})

describe('FoodView carrying card', () => {
  it('warns that food here adds to consumable gear', async () => {
    // Anyone keeping a "Food bag" gear row would otherwise double-count.
    // The copy moved into FoodCarryingList (Task 10); this pins it at its new
    // home, mounted from FoodView, since FoodCarryingList.test.tsx does not
    // assert this line itself.
    h.fetchListFood.mockResolvedValue(rescheduleFood)
    await renderFoodView()
    expect(await screen.findByText(/not counted twice/i)).toBeInTheDocument()
  })
})

describe('FoodView reschedule', () => {
  it('saves a reschedule with the new slot selection', async () => {
    h.fetchListFood.mockResolvedValue(rescheduleFood)
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: 'Reschedule' }))
    // Ramen starts scheduled at breakfast day 1; add dinner day 2 too.
    await user.click(screen.getByRole('button', { name: 'Dinner day 2' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(h.updateFoodItem).toHaveBeenCalledWith(listId, 'i1', { slotIds: ['b1', 'd2'] })
  })

  it('unschedules with an explicit empty array, not an omitted field', async () => {
    // The DTO distinguishes slotIds: [] (unschedule) from omitted (leave
    // alone) - deselecting every slot must send the explicit empty array.
    h.fetchListFood.mockResolvedValue(rescheduleFood)
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: 'Reschedule' }))
    await user.click(screen.getByRole('button', { name: 'Breakfast day 1' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(h.updateFoodItem).toHaveBeenCalledWith(listId, 'i1', { slotIds: [] })
  })

  it('closes the reschedule form on cancel without saving', async () => {
    h.fetchListFood.mockResolvedValue(rescheduleFood)
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: 'Reschedule' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(h.updateFoodItem).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
})

describe('FoodView add food', () => {
  it('closes the form only after the add succeeds', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.click(screen.getByRole('button', { name: 'Add food' }))

    expect(h.createFoodItem).toHaveBeenCalledWith(listId, {
      name: 'Oatmeal',
      weightGrams: 0,
      quantity: 1,
      slotIds: [],
    })
    // Form gone; the collapsed "Add food" toggle is back.
    expect(await screen.findByRole('button', { name: 'Add food' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('keeps the form open with typed values when the item cap is hit', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    h.createFoodItem.mockRejectedValue(new ApiError(422, 'cap'))
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.click(screen.getByRole('button', { name: 'Add food' }))

    await waitFor(() =>
      expect(toastMock.showToast).toHaveBeenCalledWith(
        `Food item limit reached (${FOOD_ITEM_CAP} per list).`,
        { type: 'error' },
      ),
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Oatmeal')
  })

  it('raises the check-the-fields toast on a 400, not the generic message', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    h.createFoodItem.mockRejectedValue(new ApiError(400, 'bad request'))
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.click(screen.getByRole('button', { name: 'Add food' }))

    await waitFor(() =>
      expect(toastMock.showToast).toHaveBeenCalledWith(
        "Couldn't add that food - check the name, weight and meals and try again.",
        { type: 'error' },
      ),
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Oatmeal')
  })

  it('cancel clears the slot selection along with the form', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    await renderFoodView()
    await user.click(within(await findDinnerRow()).getByRole('button', { name: /add/i }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Add food' }))

    expect(screen.getByRole('button', { name: 'Dinner day 1' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

describe('FoodView delete', () => {
  it('calls deleteFoodItem with the list and item id', async () => {
    h.fetchListFood.mockResolvedValue(rescheduleFood)
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: 'Remove Ramen' }))

    expect(h.deleteFoodItem).toHaveBeenCalledWith(listId, 'i1')
  })
})

describe('FoodView busy', () => {
  it('disables add, day-grid and carrying-list controls while a mutation is in flight', async () => {
    h.fetchListFood.mockResolvedValue(rescheduleFood)
    let release: () => void = () => {}
    h.deleteFoodItem.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: 'Remove Ramen' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add food' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Reschedule' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove Ramen' })).toBeDisabled()

    release()
  })
})

describe('FoodView + Add on a slot', () => {
  it('opens the form with that slot preselected', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    await renderFoodView()
    await user.click(within(await findDinnerRow()).getByRole('button', { name: /add/i }))
    expect(screen.getByRole('button', { name: 'Dinner day 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('unions into an already-open form without eating typed input', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.click(within(await findDinnerRow()).getByRole('button', { name: /add/i }))

    expect(screen.getByRole('button', { name: 'Dinner day 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Oatmeal')
  })
})
