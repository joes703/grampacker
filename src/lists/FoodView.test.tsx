// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { queryKeys } from '../lib/queries'
import { FOOD_ITEM_CAP, type ListFoodResponse } from '../../shared/food'
import { ApiError } from '../lib/api'
import { clearToasts, shownToasts } from '../test/mutation-hook-harness'
import { shimDialog } from './test/list-detail-harness'

// FoodView owns the food query's own three-state gate (AGENTS.md), separate
// from ListDetailPage's detail-data composite. This file pins that gate in
// isolation - ListDetailPage.food.test.tsx pins where FoodView is mounted
// and that a sibling detail-query failure does not reach it.
//
// It also owns every food mutation and the editor dialog. Rendering detail
// already covered at the component level - day sections and weight totals
// (FoodDaySection.test.tsx), the tally (FoodShoppingList.test.tsx), and the
// dialog's own form behavior (FoodItemDialog.test.tsx) - is NOT re-asserted
// here. This file proves the composition: which data reaches which component,
// the days-input destructive guards (unique to this view), and the exact
// mutation contract (error routing, argument shapes, success-only close,
// busy propagation).

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

// One day, three empty meals - the fixture the "+ add" tests need so the
// collapsed day's add preselects something renderable.
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

// Ramen scheduled at day 1 breakfast; day 2 dinner exists and is empty.
const editFood: ListFoodResponse = {
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

// oneDayFood plans nothing, so its day renders COLLAPSED and the day's
// single "+ add" (which preselects every meal of the day) is the add
// affordance.
async function findDayAddButton(dayName: string) {
  const daySection = await screen.findByRole('region', { name: dayName })
  return within(daySection).getByRole('button', { name: /add food for day/i })
}

async function openEditDialog(itemName: string) {
  await user.click(await screen.findByRole('button', { name: `Edit ${itemName}` }))
  return screen.getByRole('button', { name: 'Save' })
}

beforeAll(shimDialog)

beforeEach(() => {
  h.fetchListFood.mockResolvedValue(food)
  h.setFoodDays.mockResolvedValue(food)
  h.createFoodItem.mockResolvedValue({
    id: 'new-item',
    name: 'Oatmeal',
    weightGrams: 80,
    quantity: 1, isPerMeal: true, unitCount: 1,
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

describe('FoodView planning header', () => {
  it('holds the trip length, the carried total, and the add button in one card', async () => {
    h.fetchListFood.mockResolvedValue(guardFood)
    await renderFoodView()
    const daysInput = await screen.findByLabelText('Trip length in days')
    const header = daysInput.closest('section') as HTMLElement
    expect(header).not.toBeNull()
    expect(within(header).getByRole('button', { name: '+ Add food' })).toBeInTheDocument()
    // One shared stash of Ramen, 120 g: the carried total, from foodGramsFor.
    expect(within(header).getByText('Carried food')).toBeInTheDocument()
    expect(within(header).getByLabelText('120 g')).toBeInTheDocument()
    // The day grid lives outside the header card.
    expect(within(header).queryByRole('region', { name: 'Day 1' })).not.toBeInTheDocument()
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

describe('FoodView edit dialog', () => {
  it('opens from a food line in the plan and PATCHes only what changed', async () => {
    h.fetchListFood.mockResolvedValue(editFood)
    await renderFoodView()
    const save = await openEditDialog('Ramen')
    // Ramen starts scheduled at breakfast day 1; add dinner day 2 too.
    await user.click(screen.getByRole('checkbox', { name: 'Dinner day 2' }))
    await user.click(save)

    await waitFor(() =>
      expect(h.updateFoodItem).toHaveBeenCalledWith(listId, 'i1', { slotIds: ['b1', 'd2'] }),
    )
    expect(h.updateFoodItem).toHaveBeenCalledTimes(1)
    // Success closes the dialog.
    await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument())
  })

  it('unschedules with an explicit empty array, not an omitted field', async () => {
    // The DTO distinguishes slotIds: [] (unschedule) from omitted (leave
    // alone) - deselecting every slot must send the explicit empty array.
    h.fetchListFood.mockResolvedValue(editFood)
    await renderFoodView()
    const save = await openEditDialog('Ramen')
    await user.click(screen.getByRole('checkbox', { name: 'Breakfast day 1' }))
    await user.click(save)

    await waitFor(() =>
      expect(h.updateFoodItem).toHaveBeenCalledWith(listId, 'i1', { slotIds: [] }),
    )
  })

  it('keeps the dialog open with an inline alert when the save cannot be confirmed', async () => {
    h.fetchListFood.mockResolvedValue(editFood)
    h.updateFoodItem.mockRejectedValue(new Error('network'))
    await renderFoodView()
    const save = await openEditDialog('Ramen')
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Miso ramen')
    await user.click(save)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't confirm that change saved. Check the plan before trying again.",
    )
    // Still open, draft intact, no toast duplication.
    expect(screen.getByLabelText('Name')).toHaveValue('Miso ramen')
    expect(shownToasts()).toEqual([])
  })

  it('closes the dialog on cancel without saving', async () => {
    h.fetchListFood.mockResolvedValue(editFood)
    await renderFoodView()
    await openEditDialog('Ramen')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(h.updateFoodItem).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('Remove from plan deletes the item and closes on success', async () => {
    h.fetchListFood.mockResolvedValue(editFood)
    await renderFoodView()
    await openEditDialog('Ramen')
    await user.click(screen.getByRole('button', { name: 'Remove from plan' }))

    await waitFor(() => expect(h.deleteFoodItem).toHaveBeenCalledWith(listId, 'i1'))
    await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument())
  })

  it('closes when a refetch shows the item was deleted elsewhere', async () => {
    h.fetchListFood.mockResolvedValue(editFood)
    const { qc } = await renderFoodView()
    await openEditDialog('Ramen')

    await act(async () => {
      qc.setQueryData(queryKeys.listFood(listId), { ...editFood, items: [] })
    })

    await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument())
  })
})

describe('FoodView add dialog', () => {
  it('adds from the header with an explicit per-meal default and closes on success', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: '+ Add food' }))
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.click(screen.getByRole('button', { name: 'Add food' }))

    expect(h.createFoodItem).toHaveBeenCalledWith(listId, {
      name: 'Oatmeal',
      weightGrams: 0,
      quantity: 1,
      // The dialog owns the mode control now, so it sends the mode it shows
      // instead of leaning on the server default. unitCount stays derived,
      // never sent.
      isPerMeal: true,
      slotIds: [],
    })
    await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument())
  })

  it('a day "+ add" preselects that day in the dialog grid', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    await renderFoodView()
    await user.click(await findDayAddButton('Day 1'))
    expect(screen.getByRole('checkbox', { name: 'Dinner day 1' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Breakfast day 1' })).toBeChecked()
  })

  it('keeps the dialog open with the cap message when the item cap is hit', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    h.createFoodItem.mockRejectedValue(new ApiError(422, 'cap'))
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: '+ Add food' }))
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.type(screen.getByLabelText('Weight (one item)'), '80')
    await user.click(screen.getByRole('button', { name: 'Add food' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Food item limit reached (${FOOD_ITEM_CAP} per list).`,
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Oatmeal')
    expect(screen.getByLabelText('Weight (one item)')).toHaveValue(80)
  })

  it('shows the check-the-fields message on a 400, not the generic one', async () => {
    h.fetchListFood.mockResolvedValue(oneDayFood)
    h.createFoodItem.mockRejectedValue(new ApiError(400, 'bad request'))
    await renderFoodView()
    await user.click(await screen.findByRole('button', { name: '+ Add food' }))
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.click(screen.getByRole('button', { name: 'Add food' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't add that food - check the name, weight and meals and try again.",
    )
  })

  it('falls back to a toast when the failure lands after the view is gone', async () => {
    // Navigation unmounts FoodView while the create is in flight. The
    // per-call close callback is dropped, but the mutation-level handler
    // still runs; with the dialog's anchor disconnected, reportFailure must
    // route the message to a toast instead of writing it into nothing.
    h.fetchListFood.mockResolvedValue(oneDayFood)
    let reject: (err: unknown) => void = () => {}
    h.createFoodItem.mockReturnValue(
      new Promise((_resolve, rej) => {
        reject = rej
      }),
    )
    const { unmount } = await renderFoodView()
    await user.click(await screen.findByRole('button', { name: '+ Add food' }))
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.click(screen.getByRole('button', { name: 'Add food' }))
    unmount()

    await act(async () => reject(new Error('network')))

    await waitFor(() =>
      expect(shownToasts()).toEqual([
        {
          message: "Couldn't confirm the food was added. Check the plan before trying again.",
          type: 'error',
        },
      ]),
    )
  })
})

describe('FoodView stale slot ids', () => {
  // TRIMMING the trip removes slots out from under an open add dialog (a
  // focus refetch can land while it is open). The chosen id would survive in
  // dialog state, reach the server and 400 on a slot that no longer exists.
  // The dialog's live-slot filter must keep it out of both the grid and the
  // submit, without touching the typed name.
  it('drops a slot trimmed away after selection from both the grid and the submit', async () => {
    const twoDays: ListFoodResponse = {
      dayCount: 2,
      slots: [
        { id: 'b1', dayNumber: 1, meal: 'breakfast' },
        { id: 'd2', dayNumber: 2, meal: 'dinner' },
      ],
      items: [],
    }
    h.fetchListFood.mockResolvedValue(twoDays)
    const { qc } = await renderFoodView()

    // Select day 2 via its collapsed "+ add", then type a name.
    await user.click(await findDayAddButton('Day 2'))
    expect(screen.getByRole('checkbox', { name: 'Dinner day 2' })).toBeChecked()
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    expect(screen.getByText(/1 per meal × 1 meal\b/)).toBeInTheDocument()

    // The trip was shortened elsewhere; the refetch lands while the dialog
    // is open. (The background days input is inert behind the modal, so the
    // trim arrives through the cache, not through this tab's own control.)
    await act(async () => {
      qc.setQueryData(queryKeys.listFood(listId), {
        dayCount: 1,
        slots: [{ id: 'b1', dayNumber: 1, meal: 'breakfast' }],
        items: [],
      })
    })

    // The grid no longer renders that slot at all, and the summary stops
    // counting it. Typed input survives untouched throughout.
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'Dinner day 2' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText(/not scheduled yet/)).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Oatmeal')

    await user.click(screen.getByRole('button', { name: 'Add food' }))
    expect(h.createFoodItem).toHaveBeenCalledWith(listId, {
      name: 'Oatmeal',
      weightGrams: 0,
      quantity: 1,
      isPerMeal: true,
      slotIds: [],
    })
  })
})

describe('FoodView unscheduled items', () => {
  const unscheduledFood: ListFoodResponse = {
    ...editFood,
    items: [{ ...editFood.items[0]!, slotIds: [] }],
  }

  it('lists an item with no meals in a Not scheduled group that opens the editor', async () => {
    h.fetchListFood.mockResolvedValue(unscheduledFood)
    await renderFoodView()
    const group = await screen.findByRole('region', { name: 'Not scheduled' })
    await user.click(within(group).getByRole('button', { name: 'Edit Ramen' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('stays reachable even at zero trip days', async () => {
    // An item can hold no slots BECAUSE the trip was cut to zero; the group
    // must not live inside the positive-day branch or the item is stranded.
    h.fetchListFood.mockResolvedValue({ dayCount: 0, slots: [], items: unscheduledFood.items })
    await renderFoodView()
    expect(await screen.findByRole('region', { name: 'Not scheduled' })).toBeInTheDocument()
  })

  it('renders no group while every item has meals', async () => {
    h.fetchListFood.mockResolvedValue(editFood)
    await renderFoodView()
    await screen.findByRole('region', { name: 'Day 1' })
    expect(screen.queryByRole('region', { name: 'Not scheduled' })).not.toBeInTheDocument()
  })
})

describe('FoodView shopping tally', () => {
  it('renders the tally from the same items the plan shows', async () => {
    h.fetchListFood.mockResolvedValue(editFood)
    await renderFoodView()
    const tally = await screen.findByRole('region', { name: 'Shopping list' })
    expect(within(tally).getByText('Ramen')).toBeInTheDocument()
    expect(within(tally).getByText('× 1')).toBeInTheDocument()
  })

  it('offers the plan/tally switch below lg', async () => {
    // jsdom cannot evaluate the lg: classes, so this pins only the switch
    // contract (two pressed-state buttons); which panel is visible at each
    // width is verified in the browser.
    h.fetchListFood.mockResolvedValue(editFood)
    await renderFoodView()
    const plan = await screen.findByRole('button', { name: 'Meal plan' })
    const shop = screen.getByRole('button', { name: 'Shopping list' })
    expect(plan).toHaveAttribute('aria-pressed', 'true')
    await user.click(shop)
    expect(shop).toHaveAttribute('aria-pressed', 'true')
    expect(plan).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('FoodView busy', () => {
  it('freezes the dialog and the background controls while a write is in flight', async () => {
    h.fetchListFood.mockResolvedValue(editFood)
    let release: () => void = () => {}
    h.deleteFoodItem.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    await renderFoodView()
    await openEditDialog('Ramen')
    await user.click(screen.getByRole('button', { name: 'Remove from plan' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove from plan' })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '+ Add food' })).toBeDisabled()

    release()
  })
})
