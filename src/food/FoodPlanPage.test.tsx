// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import type {
  FoodItem,
  FoodPlanDocument as Doc,
  FoodPlanEntry,
  Meal,
  FoodPlanDay,
  DayMeal,
  FoodPlan,
} from '../lib/types'

// Mock the queries barrel: the real module pulls in the Supabase client, which
// throws at import without env vars. Export every runtime symbol that any module
// in the FoodPlanPage render tree imports (FoodPlanPage, FoodPlanDocument,
// FoodPicker, EntryAmountDialog, MoveCopyEntryDialog, CellEntryReorder,
// useFoodReorder, FoodPlanDayCard, MealSection, FoodPlanExtras, AddMealDialog,
// ScheduleGridDialog). Missing one throws at import time.
vi.mock('../lib/queries', () => ({
  queryKeys: {
    foodPlan: (listId: string) => ['food-plan', listId] as const,
    foodItems: () => ['food-items'] as const,
    foodPlanCopyOptions: (userId: string, targetListId: string) => ['food-plan-copy-options', userId, targetListId] as const,
  },
  // page + document data
  fetchFoodPlan: vi.fn(),
  createFoodPlan: vi.fn(),
  fetchFoodPlanCopyOptions: vi.fn(),
  copyFoodPlanToList: vi.fn(),
  invalidateFoodPlanCaches: vi.fn(),
  fetchFoodItems: vi.fn(),
  // entry writes
  upsertFoodPlanEntry: vi.fn(),
  upsertFoodPlanEntries: vi.fn(),
  updateFoodPlanEntry: vi.fn(),
  deleteFoodPlanEntry: vi.fn(),
  assertFoodPlanEntryWithinCap: () => {},
  // day writes
  addFoodPlanDay: vi.fn(),
  deleteFoodPlanDay: vi.fn(),
  updateDayType: vi.fn(),
  assertFoodPlanDayWithinCap: () => {},
  duplicateFoodPlanDay: vi.fn(),
  // meal writes
  addMealDefinition: vi.fn(),
  deleteMeal: vi.fn(),
  deleteDayMeal: vi.fn(),
  addDayMeal: vi.fn(),
  assertMealDefinitionWithinCap: () => {},
  // picker
  createFoodItem: vi.fn(),
  nextFoodItemSortOrder: () => 0,
  assertFoodItemWithinCap: () => {},
  // reorder
  bulkUpdateSortOrder: vi.fn(),
  // targets
  saveFoodPlanTargets: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../auth/use-require-session', () => ({
  useRequireSession: () => ({ userId: 'u1' }),
}))

import {
  fetchFoodPlan, fetchFoodItems, createFoodPlan, fetchFoodPlanCopyOptions, copyFoodPlanToList,
  upsertFoodPlanEntries, saveFoodPlanTargets,
} from '../lib/queries'
import FoodPlanPage from './FoodPlanPage'

// jsdom does not implement the native <dialog> showModal/close API that
// Modal.tsx drives. Polyfill them to toggle the `open` property so the modal
// content mounts and is queryable.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close() {
    this.open = false
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPage() {
  // retry:false so a rejection surfaces on the first attempt and flips isError.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/lists/L1/food']}>
        <Routes>
          <Route path="/lists/:id/food" element={<FoodPlanPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return qc
}

const NOW = '2026-01-01T00:00:00.000Z'

function makeFood(over: Partial<FoodItem> & { id: string; name: string }): FoodItem {
  return {
    user_id: 'u1',
    brand: null,
    serving_description: null,
    serving_weight_grams: 100,
    calories_per_serving: 100,
    servings_per_package: null,
    fat_grams: null,
    saturated_fat_grams: null,
    carbs_grams: null,
    fiber_grams: null,
    sugar_grams: null,
    protein_grams: null,
    sodium_mg: null,
    potassium_mg: null,
    notes: null,
    sort_order: 0,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  }
}

// A small plan: 1 plan, 2 meals (Breakfast + Dinner), 1 day, 2 day_meals,
// optional entries. entries default to [] so callers can layer their own.
function makeDoc(entries: FoodPlanEntry[] = []): Doc {
  const plan: FoodPlan = {
    id: 'plan1', user_id: 'u1', list_id: 'L1',
    is_food_shared: false, created_at: NOW, updated_at: NOW,
  }
  const breakfast: Meal = {
    id: 'meal-b', user_id: 'u1', food_plan_id: 'plan1', name: 'Breakfast',
    anchor_role: 'breakfast', is_default: true, sort_order: 0, created_at: NOW, updated_at: NOW,
  }
  const dinner: Meal = {
    id: 'meal-d', user_id: 'u1', food_plan_id: 'plan1', name: 'Dinner',
    anchor_role: 'dinner', is_default: true, sort_order: 1, created_at: NOW, updated_at: NOW,
  }
  const day: FoodPlanDay = {
    id: 'day1', user_id: 'u1', food_plan_id: 'plan1', day_type_override: null,
    sort_order: 0, created_at: NOW, updated_at: NOW,
  }
  const dmBreakfast: DayMeal = {
    id: 'dm-b', user_id: 'u1', food_plan_id: 'plan1', day_id: 'day1',
    meal_id: 'meal-b', created_at: NOW, updated_at: NOW,
  }
  const dmDinner: DayMeal = {
    id: 'dm-d', user_id: 'u1', food_plan_id: 'plan1', day_id: 'day1',
    meal_id: 'meal-d', created_at: NOW, updated_at: NOW,
  }
  return {
    plan,
    meals: [breakfast, dinner],
    days: [day],
    dayMeals: [dmBreakfast, dmDinner],
    entries,
    dailyTargets: [],
    mealTargets: [],
  }
}

function makeDocWithOmittedBreakfastDay(): Doc {
  const plan: FoodPlan = {
    id: 'plan1', user_id: 'u1', list_id: 'L1',
    is_food_shared: false, created_at: NOW, updated_at: NOW,
  }
  const breakfast: Meal = {
    id: 'meal-b', user_id: 'u1', food_plan_id: 'plan1', name: 'Breakfast',
    anchor_role: 'breakfast', is_default: true, sort_order: 0, created_at: NOW, updated_at: NOW,
  }
  const days: FoodPlanDay[] = [0, 1, 2].map((i) => ({
    id: `day${i + 1}`, user_id: 'u1', food_plan_id: 'plan1', day_type_override: null,
    sort_order: i, created_at: NOW, updated_at: NOW,
  }))
  const dayMeals: DayMeal[] = [
    {
      id: 'dm-b1', user_id: 'u1', food_plan_id: 'plan1', day_id: 'day1',
      meal_id: 'meal-b', created_at: NOW, updated_at: NOW,
    },
    {
      id: 'dm-b2', user_id: 'u1', food_plan_id: 'plan1', day_id: 'day2',
      meal_id: 'meal-b', created_at: NOW, updated_at: NOW,
    },
  ]
  return {
    plan,
    meals: [breakfast],
    days,
    dayMeals,
    entries: [],
    dailyTargets: [],
    mealTargets: [],
  }
}

function makeEntry(over: Partial<FoodPlanEntry> & { id: string; food_item_id: string }): FoodPlanEntry {
  return {
    user_id: 'u1',
    food_plan_id: 'plan1',
    day_meal_id: 'dm-b',
    is_extra: false,
    basis: 'servings',
    amount: 1,
    sort_order: 0,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  }
}

describe('FoodPlanPage create flow', () => {
  it('gates create on the day count and passes a structure of the right day length', async () => {
    vi.mocked(fetchFoodPlan).mockResolvedValue(null)
    vi.mocked(fetchFoodItems).mockResolvedValue([])
    vi.mocked(createFoodPlan).mockResolvedValue(makeDoc().plan)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Start food plan' }))

    // Dialog open. Set Days=5.
    const days = await screen.findByLabelText('Days')
    fireEvent.change(days, { target: { value: '5' } })

    // 5 days x 3 default meals = 15 planned meals.
    expect(await screen.findByText('15 planned meals')).toBeTruthy()

    // Submit (the dialog's own "Start food plan" button inside the form).
    const submit = screen.getAllByRole('button', { name: 'Start food plan' })
    fireEvent.click(submit[submit.length - 1]!)

    await waitFor(() => expect(createFoodPlan).toHaveBeenCalled())
    const call = vi.mocked(createFoodPlan).mock.calls[0]!
    expect(call[0]).toBe('u1')
    expect(call[1]).toBe('L1')
    expect((call[2] as { days: unknown[] }).days).toHaveLength(5)
  })

  it('shows the enriched empty-state copy when no plan exists', async () => {
    vi.mocked(fetchFoodPlan).mockResolvedValue(null)
    vi.mocked(fetchFoodItems).mockResolvedValue([])
    renderPage()

    expect(await screen.findByText(/Track the food you'll carry/i)).toBeTruthy()
  })

  it('copies an existing food plan into an empty list', async () => {
    vi.mocked(fetchFoodPlan).mockResolvedValue(null)
    vi.mocked(fetchFoodPlanCopyOptions).mockResolvedValue([
      { food_plan_id: 'source-plan-1', list_id: 'source-list-1', list_name: 'Wind River high route' },
    ])
    vi.mocked(copyFoodPlanToList).mockResolvedValue(makeDoc().plan)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Copy existing plan' }))

    expect(await screen.findByText(/edits will not sync back/i)).toBeTruthy()
    expect(await screen.findByLabelText('Food plan to copy')).toHaveValue('source-plan-1')
    fireEvent.click(screen.getByRole('button', { name: 'Copy food plan' }))

    await waitFor(() => expect(copyFoodPlanToList).toHaveBeenCalledWith('u1', 'source-plan-1', 'L1'))
  })

  it('falls back to a live copy option when the selected source disappears', async () => {
    vi.mocked(fetchFoodPlan).mockResolvedValue(null)
    vi.mocked(fetchFoodPlanCopyOptions)
      .mockResolvedValueOnce([
        { food_plan_id: 'source-plan-1', list_id: 'source-list-1', list_name: 'Wind River high route' },
        { food_plan_id: 'source-plan-2', list_id: 'source-list-2', list_name: 'Sierra loop' },
      ])
      .mockResolvedValueOnce([
        { food_plan_id: 'source-plan-2', list_id: 'source-list-2', list_name: 'Sierra loop' },
      ])
    vi.mocked(copyFoodPlanToList).mockResolvedValue(makeDoc().plan)
    const qc = renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Copy existing plan' }))
    const select = await screen.findByLabelText('Food plan to copy')
    fireEvent.change(select, { target: { value: 'source-plan-1' } })
    expect(select).toHaveValue('source-plan-1')

    await qc.refetchQueries({ queryKey: ['food-plan-copy-options', 'u1', 'L1'] })
    await waitFor(() => expect(fetchFoodPlanCopyOptions).toHaveBeenCalledTimes(2))
    expect(await screen.findByLabelText('Food plan to copy')).toHaveValue('source-plan-2')

    fireEvent.click(screen.getByRole('button', { name: 'Copy food plan' }))

    await waitFor(() => expect(copyFoodPlanToList).toHaveBeenCalledWith('u1', 'source-plan-2', 'L1'))
    expect(copyFoodPlanToList).not.toHaveBeenCalledWith('u1', 'source-plan-1', 'L1')
  })

  it('shows an empty copy state when there are no other food plans', async () => {
    vi.mocked(fetchFoodPlan).mockResolvedValue(null)
    vi.mocked(fetchFoodPlanCopyOptions).mockResolvedValue([])
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Copy existing plan' }))

    expect(await screen.findByText('No other food plans to copy yet.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy food plan' })).toBeDisabled()
  })
})

describe('FoodPlanPage rendering', () => {
  it('renders the loaded plan document with its meals and day', async () => {
    vi.mocked(fetchFoodPlan).mockResolvedValue(makeDoc())
    vi.mocked(fetchFoodItems).mockResolvedValue([])
    renderPage()

    expect((await screen.findAllByText('Day 1')).length).toBeGreaterThan(0)
    // Meal section headers render for each scheduled meal.
    expect(screen.getAllByText('Breakfast').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Dinner').length).toBeGreaterThan(0)
  })
})

describe('FoodPlanPage targets', () => {
  it('saves edited daily targets through the modal and closes on success', async () => {
    vi.mocked(fetchFoodPlan).mockResolvedValue(makeDoc())
    vi.mocked(fetchFoodItems).mockResolvedValue([])
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit targets' }))
    fireEvent.change(await screen.findByLabelText('Calories mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save targets' }))

    await waitFor(() => expect(saveFoodPlanTargets).toHaveBeenCalledTimes(1))
    const call = vi.mocked(saveFoodPlanTargets).mock.calls[0]!
    expect(call[0]).toBe('u1')
    expect(call[1]).toBe('plan1')
    expect(call[2].dailyUpserts).toEqual([{ metric: 'calories', mode: 'max', target_min: null, target_max: 2500 }])
    // Dialog closes on success.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save targets' })).not.toBeInTheDocument())
  })

  it('keeps the modal open and preserves the edit when the save fails', async () => {
    vi.mocked(fetchFoodPlan).mockResolvedValue(makeDoc())
    vi.mocked(fetchFoodItems).mockResolvedValue([])
    vi.mocked(saveFoodPlanTargets).mockRejectedValueOnce(new Error('boom'))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit targets' }))
    fireEvent.change(await screen.findByLabelText('Calories mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save targets' }))

    await waitFor(() => expect(saveFoodPlanTargets).toHaveBeenCalled())
    // A rejected save must not close the modal or discard the typed value. (No
    // toast assertion: this QueryClient has no MutationCache handler / toast
    // viewport - the meta.errorToast wiring is covered by mutation-error-handler tests.)
    expect(screen.getByRole('button', { name: 'Save targets' })).toBeInTheDocument()
    expect(screen.getByLabelText('Calories maximum')).toHaveValue('2500')
  })
})

describe('FoodPlanPage load error', () => {
  it('shows an error with a retry control when the plan fetch fails', async () => {
    vi.mocked(fetchFoodPlan).mockRejectedValueOnce(new Error('network down'))
    vi.mocked(fetchFoodItems).mockResolvedValue([])
    renderPage()

    expect(await screen.findByText("Couldn't load this food plan.")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})

describe('FoodPlanPage add food', () => {
  it('passes preserveBasis null for a fresh add (no existing entry in the cell)', async () => {
    const food = makeFood({ id: 'food-oat', name: 'Oatmeal' })
    vi.mocked(fetchFoodPlan).mockResolvedValue(makeDoc())
    vi.mocked(fetchFoodItems).mockResolvedValue([food])
    vi.mocked(upsertFoodPlanEntries).mockResolvedValue([makeEntry({ id: 'saved', food_item_id: 'food-oat' })])
    renderPage()

    // Open the first cell's add picker.
    const addButtons = await screen.findAllByRole('button', { name: '+ Add food' })
    fireEvent.click(addButtons[0]!)

    // Picker open: pick Oatmeal.
    const picker = await screen.findByRole('dialog', { name: 'Add food' })
    fireEvent.click(within(picker).getByRole('button', { name: /Oatmeal/ }))

    // Amount dialog: leave defaults (servings, amount 1), Save.
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => expect(upsertFoodPlanEntries).toHaveBeenCalled())
    const call = vi.mocked(upsertFoodPlanEntries).mock.calls[0]!
    expect(call[1]).toHaveLength(1)
    expect(call[1][0]?.preserve_basis).toBeNull()
  })

  it('passes the chosen preserveBasis when merging into a cell that already holds the food', async () => {
    const food = makeFood({ id: 'food-oat', name: 'Oatmeal' })
    // Existing entry in the Breakfast cell (dm-b), basis 'servings'.
    const existing = makeEntry({ id: 'entry1', food_item_id: 'food-oat', day_meal_id: 'dm-b', basis: 'servings', amount: 2 })
    vi.mocked(fetchFoodPlan).mockResolvedValue(makeDoc([existing]))
    vi.mocked(fetchFoodItems).mockResolvedValue([food])
    vi.mocked(upsertFoodPlanEntries).mockResolvedValue([makeEntry({ id: 'saved', food_item_id: 'food-oat' })])
    renderPage()

    // Open the Breakfast cell's add (first "+ Add food").
    const addButtons = await screen.findAllByRole('button', { name: '+ Add food' })
    fireEvent.click(addButtons[0]!)

    // Pick the food already in this cell.
    const picker = await screen.findByRole('dialog', { name: 'Add food' })
    fireEvent.click(within(picker).getByRole('button', { name: /Oatmeal/ }))

    // Amount dialog opens with the merge note. Switch basis to Weight (g) to
    // create a merge conflict, which reveals the preserve radio group.
    const basisSelect = await screen.findByRole('combobox')
    fireEvent.change(basisSelect, { target: { value: 'weight' } })

    // The preserve group "Keep the combined total in" appears.
    const group = await screen.findByRole('group', { name: /Keep the combined total in/ })
    // Choose the existing unit ('servings' -> label "Servings").
    fireEvent.click(within(group).getByLabelText('Servings'))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(upsertFoodPlanEntries).toHaveBeenCalled())
    const call = vi.mocked(upsertFoodPlanEntries).mock.calls[0]!
    expect(call[1][0]?.preserve_basis).toBe('servings')
  })

  it('shows omitted same-meal days as disabled in multi-day add', async () => {
    const food = makeFood({ id: 'food-oat', name: 'Oatmeal' })
    vi.mocked(fetchFoodPlan).mockResolvedValue(makeDocWithOmittedBreakfastDay())
    vi.mocked(fetchFoodItems).mockResolvedValue([food])
    vi.mocked(upsertFoodPlanEntries).mockResolvedValue([makeEntry({ id: 'saved', food_item_id: 'food-oat' })])
    renderPage()

    const addButtons = await screen.findAllByRole('button', { name: '+ Add food' })
    fireEvent.click(addButtons[0]!)

    const picker = await screen.findByRole('dialog', { name: 'Add food' })
    fireEvent.click(within(picker).getByRole('button', { name: /Oatmeal/ }))

    const amountDialog = await screen.findByRole('dialog', { name: 'Oatmeal' })
    const day2 = within(amountDialog).getByLabelText('Day 2')
    const day3 = within(amountDialog).getByLabelText('Day 3')
    expect(day2).toBeEnabled()
    expect(day3).toBeDisabled()
    expect(day3).toHaveAttribute('title', 'This meal is omitted on Day 3')

    fireEvent.click(within(amountDialog).getByRole('button', { name: 'All days' }))
    expect(day2).toBeChecked()
    expect(day3).not.toBeChecked()

    fireEvent.click(within(amountDialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(upsertFoodPlanEntries).toHaveBeenCalled())
    const call = vi.mocked(upsertFoodPlanEntries).mock.calls[0]!
    expect(call[1]).toHaveLength(2)
    expect(call[1].map((a) => a.entry.day_meal_id)).toEqual(['dm-b1', 'dm-b2'])
  })
})
