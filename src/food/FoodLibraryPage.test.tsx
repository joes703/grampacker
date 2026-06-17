// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock the queries barrel: the real module pulls in the Supabase client,
// which throws at import without env vars. Provide just what the page reads.
vi.mock('../lib/queries', () => ({
  queryKeys: {
    foodItems: () => ['food-items'] as const,
    foodPlansAll: () => ['food-plan'] as const,
    foodPackSignaturesAll: () => ['food-pack-signatures'] as const,
    foodPackStateAll: () => ['food-pack-state'] as const,
  },
  fetchFoodItems: vi.fn(),
  createFoodItem: vi.fn(),
  updateFoodItem: vi.fn(),
  deleteFoodItem: vi.fn(),
  nextFoodItemSortOrder: () => 0,
  assertFoodItemWithinCap: () => {},
  makeOptimisticInsert: () => ({}),
  makeOptimisticUpdate: () => ({}),
  makeOptimisticDelete: () => ({}),
}))

vi.mock('../auth/use-require-session', () => ({
  useRequireSession: () => ({ userId: 'u1' }),
}))

import { fetchFoodItems } from '../lib/queries'
import { FOOD_CSV_HEADER } from '../lib/csv'
import FoodLibraryPage from './FoodLibraryPage'
import type { FoodItem } from '../lib/types'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

function food(overrides: Partial<FoodItem> = {}): FoodItem {
  return {
    id: 'food-a',
    user_id: 'u1',
    name: 'Alpha Bar',
    brand: 'Acme',
    serving_description: '1 bar',
    serving_weight_grams: 50,
    calories_per_serving: 200,
    servings_per_package: 1,
    fat_grams: 8,
    saturated_fat_grams: 2,
    carbs_grams: 25,
    fiber_grams: 4,
    sugar_grams: 10,
    protein_grams: 10,
    sodium_mg: 120,
    potassium_mg: 180,
    notes: null,
    sort_order: 0,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderPage() {
  // retry:false so a rejection surfaces on the first attempt and flips isError.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <FoodLibraryPage />
    </QueryClientProvider>,
  )
}

describe('FoodLibraryPage error state', () => {
  it('shows an error with a retry control when the fetch fails, not the empty state', async () => {
    vi.mocked(fetchFoodItems).mockRejectedValueOnce(new Error('network down'))
    renderPage()

    expect(await screen.findByText("Couldn't load your food library.")).toBeTruthy()
    // The empty-library affordance must NOT appear on a failed load.
    expect(screen.queryByText('Your food library is empty.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('refetches when Try again is clicked', async () => {
    vi.mocked(fetchFoodItems)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([])
    renderPage()

    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(fetchFoodItems).toHaveBeenCalledTimes(1)

    fireEvent.click(retry)

    // After a successful refetch the empty state replaces the error state.
    expect(await screen.findByText('Your food library is empty.')).toBeTruthy()
    expect(fetchFoodItems).toHaveBeenCalledTimes(2)
  })
})

describe('FoodLibraryPage CSV format affordance', () => {
  it('renders a CSV format control that opens the canonical-header help', async () => {
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([])
    renderPage()

    const trigger = await screen.findByRole('button', { name: /csv format/i })
    fireEvent.click(trigger)

    // The dialog shows the canonical header and a Copy header button.
    expect(screen.getByText(FOOD_CSV_HEADER)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy header/i })).toBeInTheDocument()
  })
})

describe('FoodLibraryPage table view', () => {
  it('renders a scan-friendly table with serving, calories, and density columns', async () => {
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([
      food({ id: 'b', name: 'Beta Mix', brand: null, serving_weight_grams: 100, calories_per_serving: 350 }),
      food({ id: 'a', name: 'Alpha Bar', brand: 'Acme', serving_weight_grams: 50, calories_per_serving: 200 }),
    ])
    renderPage()

    const table = await screen.findByRole('table', { name: 'Food library' })
    expect(within(table).getByRole('columnheader', { name: /food/i })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /serving/i })).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: /sort by calories/i })).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: /sort by density/i })).toBeInTheDocument()
    expect(within(table).getByText('4.00 kcal/g')).toBeInTheDocument()
    expect(within(table).getByText('3.50 kcal/g')).toBeInTheDocument()
  })

  it('sorts by calories when the Calories header is clicked', async () => {
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([
      food({ id: 'low', name: 'Low Calorie', calories_per_serving: 100 }),
      food({ id: 'high', name: 'High Calorie', calories_per_serving: 500 }),
    ])
    renderPage()

    await screen.findByText('Low Calorie')
    fireEvent.click(screen.getByRole('button', { name: /sort by calories/i }))

    const rows = screen.getAllByTestId('food-library-row')
    expect(rows[0]).toHaveTextContent('High Calorie')
    expect(rows[1]).toHaveTextContent('Low Calorie')
  })

  it('shows macro columns only after Show macros is enabled, using dashes for unknown values', async () => {
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([
      food({
        id: 'partial',
        name: 'Mystery Dinner',
        protein_grams: null,
        carbs_grams: 40,
        fat_grams: null,
        fiber_grams: null,
        sodium_mg: null,
        potassium_mg: null,
      }),
    ])
    renderPage()

    await screen.findByText('Mystery Dinner')
    expect(screen.queryByRole('columnheader', { name: /protein/i })).toBeNull()

    fireEvent.click(screen.getByRole('switch', { name: /show macros/i }))

    expect(screen.getByRole('columnheader', { name: /protein/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /carbs/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /c:p/i })).toBeInTheDocument()
    const row = screen.getByTestId('food-library-row')
    expect(within(row).getByText('40.0 g')).toBeInTheDocument()
    expect(within(row).getAllByText('-').length).toBeGreaterThanOrEqual(4)
  })

  it('switches density display between kcal/g and kcal/oz', async () => {
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([
      food({ id: 'dense', name: 'Dense Bar', serving_weight_grams: 50, calories_per_serving: 200 }),
    ])
    renderPage()

    expect(await screen.findByText('4.00 kcal/g')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('oz'))

    expect(await screen.findByText('113.4 kcal/oz')).toBeInTheDocument()
    expect(screen.queryByText('4.00 kcal/g')).toBeNull()
  })
})
