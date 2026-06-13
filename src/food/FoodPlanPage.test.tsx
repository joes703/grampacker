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
  },
  // page + document data
  fetchFoodPlan: vi.fn(),
  createFoodPlan: vi.fn(),
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
}))

vi.mock('../auth/use-require-session', () => ({
  useRequireSession: () => ({ userId: 'u1' }),
}))

import { fetchFoodPlan, fetchFoodItems, createFoodPlan, upsertFoodPlanEntries } from '../lib/queries'
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
    id: 'plan1', user_id: 'u1', list_id: 'L1', num_nights: null,
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
  it('gates create on the DAY count and passes nights + a structure of the right day length', async () => {
    vi.mocked(fetchFoodPlan).mockResolvedValue(null)
    vi.mocked(fetchFoodItems).mockResolvedValue([])
    vi.mocked(createFoodPlan).mockResolvedValue(makeDoc().plan)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Start food plan' }))

    // Dialog open. Set Days=5, Nights=4.
    const days = await screen.findByLabelText('Days')
    const nights = screen.getByLabelText(/Nights/)
    fireEvent.change(days, { target: { value: '5' } })
    fireEvent.change(nights, { target: { value: '4' } })

    // 5 days x 3 default meals = 15 planned meals (driven by DAY count, not nights).
    expect(await screen.findByText('15 planned meals')).toBeTruthy()

    // Submit (the dialog's own "Start food plan" button inside the form).
    const submit = screen.getAllByRole('button', { name: 'Start food plan' })
    fireEvent.click(submit[submit.length - 1]!)

    await waitFor(() => expect(createFoodPlan).toHaveBeenCalled())
    const call = vi.mocked(createFoodPlan).mock.calls[0]!
    expect(call[0]).toBe('u1')
    expect(call[1]).toBe('L1')
    expect(call[2]).toBe(4) // nights arg, NOT the day count
    expect((call[3] as { days: unknown[] }).days).toHaveLength(5)
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
    fireEvent.click(await screen.findByRole('button', { name: 'Oatmeal' }))

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
    fireEvent.click(await screen.findByRole('button', { name: 'Oatmeal' }))

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
})
