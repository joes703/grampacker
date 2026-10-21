// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { queryKeys } from '../lib/queries'
import { FOOD_ITEM_CAP, type ListFoodResponse } from '../../shared/food'
import { ApiError } from '../lib/api'
import { clearToasts, shownToasts } from '../test/mutation-hook-harness'

// FoodView owns the food query's own three-state gate (AGENTS.md), separate
// from ListDetailPage's detail-data composite. This file pins that gate in
// isolation - ListDetailPage.food.test.tsx pins where FoodView is mounted
// and that a sibling detail-query failure does not reach it.
//
// It also owns every food mutation. Its FoodDocument is composed from
// FoodDaySection, AddFoodForm, FoodCarryingList and FoodSlotPicker.
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
  createFoodItem: vi.fn(),
  updateFoodItem: vi.fn(),
  deleteFoodItem: vi.fn(),
}))

vi.mock('../lib/queries/food', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries/food')>()
  return { ...actual, ...h }
})

const listId = 'list-1'
const user = userEvent.setup()

const food: ListFoodResponse = {
  dayCount: 3,
  slots: [{ id: 'slot-1', dayNumber: 1, meal: 'breakfast' }],
  items: [],
} as unknown as ListFoodResponse

// One day, three empty meals - the fixture the "+ Add"
// tests need so the dinner slot renders its own "+ Add" affordance.
const oneDayFood: ListFoodResponse = {
  dayCount: 1,
  slots: [
    { id: 'b1', dayNumber: 1, meal: 'breakfast' },
    { id: 'l1', dayNumber: 1, meal: 'lunch' },
    { id: 'd1', dayNumber: 1, meal: 'dinner' },
  ],
  items: [],
}

// The destructive-guards fixture: day 1 breakfast
// is empty (untouched, no work to lose), day 3 lunch holds Ramen (the one
// slot a shortening below day 3 would actually cost).
const guardFood: ListFoodResponse = {
  dayCount: 3,
  slots: [
    { id: 'b1', dayNumber: 1, meal: 'breakfast' },
    { id: 'l3', dayNumber: 3, meal: 'lunch' },
  ],
  items: [{ id: 'i1', name: 'Ramen', weightGrams: 120, quantity: 1, isPerMeal: false, unitCount: 1, sortOrder: 0, isPacked: false, isReady: false, packingLocationId: null, packSortOrder: 0, slotIds: ['l3'] }],
}

const rescheduleFood: ListFoodResponse = {
  dayCount: 2,
  slots: [
    { id: 'b1', dayNumber: 1, meal: 'breakfast' },
    { id: 'd2', dayNumber: 2, meal: 'dinner' },
  ],
  items: [{ id: 'i1', name: 'Ramen', weightGrams: 120, quantity: 1, isPerMeal: false, unitCount: 1, sortOrder: 0, isPacked: false, isReady: false, packingLocationId: null, packSortOrder: 0, slotIds: ['b1'] }],
}

function renderFoodView() {
  const qc = new QueryClient({
    // Mirrors the app-wide defaults in src/App.tsx. refetchOnWindowFocus is
    // load-bearing here, not incidental: React Query's OWN default is true, so
    // a client that omits it makes the staleness test below pass whether or
    // not FoodView opts in. Verified by removing the option and watching the
    // test still pass.
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
  return import('./FoodView').then(({ default: FoodView }) => ({
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <FoodView listId={listId} />
      </QueryClientProvider>,
    ),
  }))
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
  h.createFoodItem.mockResolvedValue({
    id: 'new-item',
    name: 'Oatmeal',
    weightGrams: 80,
    quantity: 1, isPerMeal: false, unitCount: 1,
    sortOrder: 0,
    slotIds: [],
  })
  h.updateFoodItem.mockResolvedValue({
    id: 'i1',
    name: 'Ramen',
    weightGrams: 120,
    quantity: 1, isPerMeal: false, unitCount: 1,
    sortOrder: 0,
    slotIds: [],
  })
  h.deleteFoodItem.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  clearToasts()
})

describe('FoodView quantity', () => {
  // Through the carrying row's control, at a count of 1 (the row must offer it
  // even then). quantity ONLY - a PATCH that also carried slotIds would
  // rewrite the schedule as a side effect of changing a count.
  it('patches only the quantity', async () => {
    h.fetchListFood.mockResolvedValue(guardFood)
    await renderFoodView()

    await user.click(
      await screen.findByRole('button', { name: 'Edit quantity 1 for Ramen' }),
    )
    await user.keyboard('5{Enter}')

    await waitFor(() =>
      expect(h.updateFoodItem).toHaveBeenCalledWith(listId, 'i1', { quantity: 5 }),
    )
  })

  // No failure-toast test here on purpose: this mutation declares
  // meta.errorToast, and that is raised by the global handler wired onto the
  // real QueryClient in src/App.tsx, which this harness does not build. The
  // hand-rolled toasts (the add-item one) are the testable ones. Covered by
  // mutation-error-handler.test.ts instead.
})

describe('FoodView per-meal toggle', () => {
  // Per meal or shared decides how many the user carries (see foodUnitCount),
  // so the row's switch must save the opposite of the current mode, and only
  // that field: carrying slotIds or quantity too would rewrite the plan.
  it.each([
    { from: 'shared', isPerMeal: false, to: true },
    { from: 'per meal', isPerMeal: true, to: false },
  ])('a $from item switched from its row PATCHes isPerMeal: $to', async ({ from, isPerMeal, to }) => {
    const ramen = guardFood.items[0]
    if (!ramen) throw new Error('guardFood has no item')
    h.fetchListFood.mockResolvedValue({ ...guardFood, items: [{ ...ramen, isPerMeal }] })
    await renderFoodView()

    await user.click(
      await screen.findByRole('button', { name: `Ramen is ${from}. Switch.` }),
    )

    await waitFor(() =>
      expect(h.updateFoodItem).toHaveBeenCalledWith(listId, 'i1', { isPerMeal: to }),
    )
    expect(h.updateFoodItem).toHaveBeenCalledTimes(1)
  })
})

describe('FoodView staleness', () => {
  // Every destructive food action decides from this cache, so the view opts
  // OUT of the app-wide refetchOnWindowFocus: false. Without it a tab left
  // open re-reads nothing, and trimming days or rescheduling from that stale
  // snapshot deletes meals another client added. Behavioral on purpose: drop
  // the option and no second fetch happens.
  afterEach(() => {
    focusManager.setFocused(undefined)
  })

  it('refetches the plan when the window regains focus', async () => {
    await renderFoodView()
    await waitFor(() => expect(h.fetchListFood).toHaveBeenCalledTimes(1))

    focusManager.setFocused(false)
    focusManager.setFocused(true)

    await waitFor(() => expect(h.fetchListFood).toHaveBeenCalledTimes(2))
  })
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
})

describe('FoodView header', () => {
  it('renders the trip-length control and the add affordance in ONE rail card', async () => {
    await renderFoodView()
    // The rail is a single surface: header strip, add affordance and the
    // Carrying list share one card instead of stacking three fragments. The
    // closest('section') is that card, so this pins the composition rather
    // than just global presence; the day grid lives outside it.
    const daysInput = await screen.findByLabelText('Trip length in days')
    const rail = daysInput.closest('section') as HTMLElement
    expect(rail).not.toBeNull()
    expect(within(rail).getByRole('button', { name: '+ Add food' })).toBeInTheDocument()
    expect(within(rail).queryByRole('region', { name: 'Day 1' })).not.toBeInTheDocument()
    // No explainer line: the header card is compact rail chrome, not a place
    // for onboarding copy.
    expect(
      screen.queryByText("Skip meals you'll eat in town or on the road."),
    ).not.toBeInTheDocument()
  })
})

describe('FoodView empty state', () => {
  it('explains what setting a trip length does when there are zero days', async () => {
    h.fetchListFood.mockResolvedValue({ dayCount: 0, slots: [], items: [] })
    await renderFoodView()
    expect(
      await screen.findByText(/Add what you are eating and when/),
    ).toBeInTheDocument()
  })
})

describe('FoodView days-input destructive guards', () => {
  it('treats an emptied day field as a typo, not as zero days', async () => {
    // Number('') is 0, and 0 days deletes every slot on the list. Clearing the
    // box to retype it must not wipe the trip. The confirm answers yes, so
    // only the empty-field guard stands between the blur and the write.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    h.fetchListFood.mockResolvedValue(guardFood)
    await renderFoodView()
    const input = await screen.findByLabelText('Trip length in days')
    await user.clear(input)
    await user.tab()

    expect(h.setFoodDays).not.toHaveBeenCalled()
    expect(input).toHaveValue(3)
    confirmSpy.mockRestore()
  })

  it('reverts an out-of-range value instead of committing it', async () => {
    // Also proves the field is live once the read resolves: user.clear
    // throws on a disabled input, and the value is the loaded day count.
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

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    expect(h.setFoodDays).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('asks from the latest plan: food another device planned on a cut day counts', async () => {
    // This tab read the plan with nothing on day 3. Since then another device
    // scheduled Ramen there. Shortening to 2 days would delete that meal, so
    // the question must come from a fresh read, not this tab's copy.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const unplanned = { ...guardFood, items: [{ ...guardFood.items[0]!, slotIds: [] }] }
    h.fetchListFood.mockResolvedValueOnce(unplanned).mockResolvedValue(guardFood)
    await renderFoodView()
    const input = await screen.findByLabelText('Trip length in days')
    await user.clear(input)
    await user.type(input, '2')
    await user.tab()

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    expect(h.setFoodDays).not.toHaveBeenCalled()
    await waitFor(() => expect(input).toHaveValue(3))
    confirmSpy.mockRestore()
  })

  it('still asks from the latest plan when the food query is canceled mid-read', async () => {
    // Other food writes cancel this query. A canceled cache fetch resolves
    // with the OLD cached data, so a preflight that went through the cache
    // would decide from the stale plan and skip the question.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const unplanned = { ...guardFood, items: [{ ...guardFood.items[0]!, slotIds: [] }] }
    let resolveRead: (value: ListFoodResponse) => void = () => {}
    h.fetchListFood
      .mockResolvedValueOnce(unplanned)
      .mockReturnValueOnce(new Promise((r) => { resolveRead = r }))
      .mockResolvedValue(guardFood)
    const { qc } = await renderFoodView()
    const input = await screen.findByLabelText('Trip length in days')
    await user.clear(input)
    await user.type(input, '2')
    await user.tab()
    await waitFor(() => expect(h.fetchListFood).toHaveBeenCalledTimes(2))

    await act(async () => {
      await qc.cancelQueries({ queryKey: queryKeys.listFood(listId) })
    })
    await act(async () => resolveRead(guardFood))

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    expect(h.setFoodDays).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('does not ask when the latest plan has nothing on the cut days', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const unplanned = { ...guardFood, items: [{ ...guardFood.items[0]!, slotIds: [] }] }
    h.fetchListFood.mockResolvedValueOnce(guardFood).mockResolvedValue(unplanned)
    await renderFoodView()
    const input = await screen.findByLabelText('Trip length in days')
    await user.clear(input)
    await user.type(input, '2')
    await user.tab()

    await waitFor(() => expect(h.setFoodDays).toHaveBeenCalledWith(listId, 2))
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('writes nothing, and says so, when the latest plan cannot be loaded', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    h.fetchListFood.mockResolvedValueOnce(guardFood).mockRejectedValue(new Error('offline'))
    await renderFoodView()
    const input = await screen.findByLabelText('Trip length in days')
    await user.clear(input)
    await user.type(input, '2')
    await user.tab()

    await waitFor(() =>
      expect(shownToasts()).toEqual([
        {
          message:
            "Couldn't load the latest food plan, so the trip length was not changed.",
          type: 'error',
        },
      ]),
    )
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(h.setFoodDays).not.toHaveBeenCalled()
    await waitFor(() => expect(input).toBeEnabled())
    expect(input).toHaveValue(3)
    confirmSpy.mockRestore()
  })

  it('writes nothing when the latest plan already has the typed length', async () => {
    // Another device already made it 5 days.
    h.fetchListFood.mockResolvedValueOnce(food).mockResolvedValue({ ...food, dayCount: 5 })
    await renderFoodView()
    const input = await screen.findByLabelText('Trip length in days')
    await user.clear(input)
    await user.type(input, '5')
    await user.tab()

    await waitFor(() => expect(input).toBeEnabled())
    await waitFor(() => expect(input).toHaveValue(5))
    expect(h.setFoodDays).not.toHaveBeenCalled()
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

    await waitFor(() => expect(h.setFoodDays).toHaveBeenCalledWith(listId, 3))
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})

// The day write is not optimistic, so the box holds a typed number the server
// has not accepted. Once the write settles, either way, the box must show the
// trip length the cache holds, not what was typed.
describe('FoodView days-input after the write settles', () => {
  async function commitDays(value: string) {
    const input = await screen.findByLabelText('Trip length in days')
    await user.clear(input)
    await user.type(input, value)
    await user.tab()
    return input
  }

  it('shows the refetched length, not a stale copy, when the rejected write saw it move', async () => {
    // The write refetches first; here another tab has already made it 4 days.
    h.fetchListFood.mockResolvedValueOnce(food).mockResolvedValue({ ...food, dayCount: 4 })
    h.setFoodDays.mockRejectedValue(new ApiError(400, 'Bad request'))
    await renderFoodView()
    const input = await commitDays('5')

    await waitFor(() => expect(h.setFoodDays).toHaveBeenCalledWith(listId, 5))
    await waitFor(() => expect(input).toHaveValue(4))
  })

  it('keeps the saved length when the read after a successful change fails', async () => {
    // Initial read and the pre-write refetch say 3; the PUT succeeds with 5;
    // the follow-up read fails. Invalidation swallows that failure, so the
    // box must rely on the PUT's own answer, not fall back to the old 3.
    h.setFoodDays.mockResolvedValue({ ...food, dayCount: 5 })
    h.fetchListFood
      .mockResolvedValueOnce(food)
      .mockResolvedValueOnce(food)
      .mockRejectedValue(new Error('network'))
    await renderFoodView()
    const input = await commitDays('5')

    await waitFor(() => expect(h.fetchListFood).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(input).toBeEnabled())
    expect(input).toHaveValue(5)
  })

  it('keeps the saved length when an older read lands after leaving the view', async () => {
    // A focus refetch starts while a slow PUT is pending and reads the old 3
    // days. The user leaves the view, so invalidation no longer cancels that
    // inactive read. The PUT then answers 5, and the stale read lands last.
    let resolvePut: (value: ListFoodResponse) => void = () => {}
    let resolveLateRead: (value: ListFoodResponse) => void = () => {}
    h.setFoodDays.mockReturnValue(new Promise((r) => { resolvePut = r }))
    h.fetchListFood
      .mockResolvedValueOnce(food)
      .mockResolvedValueOnce(food)
      .mockReturnValueOnce(new Promise((r) => { resolveLateRead = r }))
      .mockResolvedValue({ ...food, dayCount: 5 })
    const { qc, unmount } = await renderFoodView()
    await commitDays('5')
    await waitFor(() => expect(h.setFoodDays).toHaveBeenCalledWith(listId, 5))

    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await waitFor(() => expect(h.fetchListFood).toHaveBeenCalledTimes(3))
    unmount()
    focusManager.setFocused(undefined)

    await act(async () => resolvePut({ ...food, dayCount: 5 }))
    await act(async () => resolveLateRead(food))

    await waitFor(() =>
      expect(qc.getQueryData<ListFoodResponse>(queryKeys.listFood(listId))?.dayCount).toBe(5),
    )
    // Settle: the stale read must not land after the check either.
    await act(async () => {})
    expect(qc.getQueryData<ListFoodResponse>(queryKeys.listFood(listId))?.dayCount).toBe(5)
  })

  it('follows the server when a successful write is not what it reports afterwards', async () => {
    // The write succeeded, but the follow-up read still says 3 days (another
    // tab changed it back). The box must not keep claiming 5.
    h.setFoodDays.mockResolvedValue({ ...food, dayCount: 5 })
    h.fetchListFood.mockResolvedValue(food)
    await renderFoodView()
    const input = await commitDays('5')

    await waitFor(() => expect(h.setFoodDays).toHaveBeenCalledWith(listId, 5))
    await waitFor(() => expect(input).toBeEnabled())
    await waitFor(() => expect(input).toHaveValue(3))
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
    await user.click(await screen.findByRole('button', { name: '+ Add food' }))
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.click(screen.getByRole('button', { name: 'Add food' }))

    expect(h.createFoodItem).toHaveBeenCalledWith(listId, {
      name: 'Oatmeal',
      weightGrams: 0,
      // Neither isPerMeal nor unitCount: the create request omits the mode so
      // the server's per-meal default applies, and unitCount is derived, never
      // sent. A payload carrying either would be the client deciding something
      // that is not its to decide.
      quantity: 1,
      slotIds: [],
    })
    // Form gone; the collapsed "+ Add food" toggle is back.
    expect(await screen.findByRole('button', { name: '+ Add food' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('keeps the form open with typed values when the item cap is hit', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    h.createFoodItem.mockRejectedValue(new ApiError(422, 'cap'))
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: '+ Add food' }))
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.type(screen.getByLabelText('Weight'), '80')
    await user.clear(screen.getByLabelText('Qty'))
    await user.type(screen.getByLabelText('Qty'), '3')
    await user.click(screen.getByRole('button', { name: 'Add food' }))

    await waitFor(() =>
      expect(shownToasts()).toEqual([
        { message: `Food item limit reached (${FOOD_ITEM_CAP} per list).`, type: 'error' },
      ]),
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Oatmeal')
    expect(screen.getByLabelText('Weight')).toHaveValue(80)
    expect(screen.getByLabelText('Qty')).toHaveValue(3)
  })

  it('raises the check-the-fields toast on a 400, not the generic message', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    h.createFoodItem.mockRejectedValue(new ApiError(400, 'bad request'))
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: '+ Add food' }))
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.click(screen.getByRole('button', { name: 'Add food' }))

    await waitFor(() =>
      expect(shownToasts()).toEqual([
        {
          message:
            "Couldn't add that food - check the name, weight and meals and try again.",
          type: 'error',
        },
      ]),
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Oatmeal')
  })

  it('cancel clears the slot selection along with the form', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    await renderFoodView()
    await user.click(within(await findDinnerRow()).getByRole('button', { name: /add/i }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: '+ Add food' }))

    expect(screen.getByRole('button', { name: 'Dinner day 1' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

describe('FoodView stale slot ids', () => {
  // FoodView owns selectedSlotIds while the picker renders only slots that
  // currently exist. TRIMMING the trip removes slots out from under an open
  // add form. The id would survive in state, reach the server and 400 on a
  // slot that no longer exists. activeSelectedSlotIds must keep it out of both
  // the picker and the submit, without touching the typed name.
  it('drops a slot trimmed away after selection from both the picker and the submit', async () => {
    const twoDays: ListFoodResponse = {
      dayCount: 2,
      slots: [
        { id: 'b1', dayNumber: 1, meal: 'breakfast' },
        { id: 'd2', dayNumber: 2, meal: 'dinner' },
      ],
      items: [],
    }
    // After the trim, day 2 is gone.
    h.fetchListFood.mockResolvedValueOnce(twoDays).mockResolvedValue({
      dayCount: 1,
      slots: [{ id: 'b1', dayNumber: 1, meal: 'breakfast' }],
      items: [],
    })
    await renderFoodView()

    // Select day 2 dinner via its own "+ Add", then type a name.
    const day2 = await screen.findByRole('region', { name: 'Day 2' })
    await user.click(within(day2).getByRole('button', { name: /add/i }))
    expect(screen.getByRole('button', { name: 'Dinner day 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    expect(screen.getByText(/Adding: Oatmeal/)).toHaveTextContent('dinner')

    // Shorten the trip to one day. The empty day 2 holds no food, so this asks
    // no confirmation - it just takes the slot away.
    const input = screen.getByLabelText('Trip length in days')
    await user.clear(input)
    await user.type(input, '1')
    await user.tab()

    // The picker no longer renders that slot at all, so no stale pressed chip.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Dinner day 2' })).not.toBeInTheDocument(),
    )
    // The preview derives from the same filtered prop and must stop naming it.
    expect(screen.getByText(/Adding: Oatmeal/)).not.toHaveTextContent('dinner')
    // Typed input survives untouched throughout.
    expect(screen.getByLabelText('Name')).toHaveValue('Oatmeal')

    await user.click(screen.getByRole('button', { name: 'Add food' }))
    expect(h.createFoodItem).toHaveBeenCalledWith(listId, {
      name: 'Oatmeal',
      weightGrams: 0,
      // Neither isPerMeal nor unitCount: the create request omits the mode so
      // the server's per-meal default applies, and unitCount is derived, never
      // sent. A payload carrying either would be the client deciding something
      // that is not its to decide.
      quantity: 1,
      slotIds: [],
    })
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

    await waitFor(() => expect(screen.getByRole('button', { name: '+ Add food' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Reschedule' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove Ramen' })).toBeDisabled()

    release()
  })
})

describe('FoodView + Add on a slot', () => {
  it('opens the form with that slot preselected and moves focus to Name', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    await renderFoodView()
    await user.click(within(await findDinnerRow()).getByRole('button', { name: /add/i }))
    expect(screen.getByRole('button', { name: 'Dinner day 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // The form precedes the day grid in DOM order, so Tab from the clicked
    // "+ Add" walks away from it - the focus handoff is what makes the form
    // reachable for keyboard users at all.
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus())
  })

  it('unions into an already-open form without eating typed input', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: '+ Add food' }))
    // The open button unmounts in favor of the form; focus must not be
    // dropped on body.
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus())
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.click(within(await findDinnerRow()).getByRole('button', { name: /add/i }))

    expect(screen.getByRole('button', { name: 'Dinner day 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Oatmeal')
    // Focus returns to Name on the union as well, not just first open.
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus())
  })
})
