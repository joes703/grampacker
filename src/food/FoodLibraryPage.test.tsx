// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
  vi.unstubAllGlobals()
})

// jsdom has no matchMedia; the page reads useIsMobile() during render. Default
// every test to the desktop table; mobile tests opt in with stubViewport(true).
function stubViewport(mobile: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 767px)' ? mobile : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

beforeEach(() => stubViewport(false))

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

  it('toggles numeric sorting between descending and ascending', async () => {
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([
      food({ id: 'low', name: 'Low Calorie', calories_per_serving: 100 }),
      food({ id: 'mid', name: 'Medium Calorie', calories_per_serving: 300 }),
      food({ id: 'high', name: 'High Calorie', calories_per_serving: 500 }),
    ])
    renderPage()

    await screen.findByText('Low Calorie')
    const calories = screen.getByRole('button', { name: /sort by calories/i })

    fireEvent.click(calories)
    let rows = screen.getAllByTestId('food-library-row')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('High Calorie'),
      expect.stringContaining('Medium Calorie'),
      expect.stringContaining('Low Calorie'),
    ])

    fireEvent.click(calories)
    rows = screen.getAllByTestId('food-library-row')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Low Calorie'),
      expect.stringContaining('Medium Calorie'),
      expect.stringContaining('High Calorie'),
    ])
  })

  it('keeps unknown macro values below known values in both sort directions', async () => {
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([
      food({ id: 'unknown-a', name: 'Unknown Alpha', protein_grams: null }),
      food({ id: 'known-low', name: 'Known Low', protein_grams: 4 }),
      food({ id: 'unknown-b', name: 'Unknown Beta', protein_grams: null }),
      food({ id: 'known-high', name: 'Known High', protein_grams: 20 }),
    ])
    renderPage()

    await screen.findByText('Known Low')
    fireEvent.click(screen.getByRole('switch', { name: /show macros/i }))
    const protein = screen.getByRole('button', { name: /sort by protein/i })

    fireEvent.click(protein)
    let rows = screen.getAllByTestId('food-library-row')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Known High'),
      expect.stringContaining('Known Low'),
      expect.stringContaining('Unknown Alpha'),
      expect.stringContaining('Unknown Beta'),
    ])

    fireEvent.click(protein)
    rows = screen.getAllByTestId('food-library-row')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Known Low'),
      expect.stringContaining('Known High'),
      expect.stringContaining('Unknown Alpha'),
      expect.stringContaining('Unknown Beta'),
    ])
  })

  it('sorts by name ascending by default and reverses when the Food header is clicked', async () => {
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([
      food({ id: 'c', name: 'Cherry', brand: null }),
      food({ id: 'a', name: 'Apple', brand: null }),
      food({ id: 'b', name: 'Banana', brand: null }),
    ])
    renderPage()

    await screen.findByText('Apple')
    const order = () => screen.getAllByTestId('food-library-row').map((row) => row.textContent)
    // Default sort is name ascending.
    expect(order()).toEqual([
      expect.stringContaining('Apple'),
      expect.stringContaining('Banana'),
      expect.stringContaining('Cherry'),
    ])

    const foodHeader = screen.getByRole('button', { name: 'Sort by Food' })
    fireEvent.click(foodHeader)
    expect(order()).toEqual([
      expect.stringContaining('Cherry'),
      expect.stringContaining('Banana'),
      expect.stringContaining('Apple'),
    ])

    fireEvent.click(foodHeader)
    expect(order()).toEqual([
      expect.stringContaining('Apple'),
      expect.stringContaining('Banana'),
      expect.stringContaining('Cherry'),
    ])
  })

  it('breaks ties between unknown values by name, not input order', async () => {
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([
      food({ id: 'z', name: 'Zucchini', brand: null, protein_grams: null }),
      food({ id: 'm', name: 'Mango', brand: null, protein_grams: 5 }),
      food({ id: 'a', name: 'Apricot', brand: null, protein_grams: null }),
    ])
    renderPage()

    await screen.findByText('Mango')
    fireEvent.click(screen.getByRole('switch', { name: /show macros/i }))
    fireEvent.click(screen.getByRole('button', { name: /sort by protein/i }))

    // The known value ranks first; the two unknowns tie and fall back to name
    // ascending (Apricot before Zucchini) despite their reversed input order.
    const order = screen.getAllByTestId('food-library-row').map((row) => row.textContent)
    expect(order).toEqual([
      expect.stringContaining('Mango'),
      expect.stringContaining('Apricot'),
      expect.stringContaining('Zucchini'),
    ])
  })

  it('truncates long food names instead of widening the table', async () => {
    const longName = 'Very long food name that should not force the whole food library table to widen'
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([
      food({ id: 'long', name: longName }),
    ])
    renderPage()

    const name = await screen.findByText(longName)
    expect(name).toHaveClass('truncate')
    expect(name).toHaveAttribute('title', longName)
    // truncate only clips when its cell caps width; the bound is what keeps a
    // long name from widening the whole column.
    expect(name.closest('td')).toHaveClass('max-w-64')
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

describe('FoodLibraryPage mobile card view', () => {
  it('renders the desktop table at md+ and not the mobile card list', async () => {
    stubViewport(false)
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([food({ id: 'a', name: 'Alpha Bar' })])
    renderPage()

    expect(await screen.findByRole('table', { name: 'Food library' })).toBeInTheDocument()
    expect(screen.queryByTestId('food-library-mobile-list')).toBeNull()
  })

  it('renders foods as tappable cards below md, not the table', async () => {
    stubViewport(true)
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([
      food({
        id: 'a', name: 'Alpha Bar', brand: 'Acme', serving_description: '1 bar',
        serving_weight_grams: 50, calories_per_serving: 200,
      }),
    ])
    renderPage()

    const list = await screen.findByTestId('food-library-mobile-list')
    expect(screen.queryByRole('table', { name: 'Food library' })).toBeNull()

    const row = within(list).getByTestId('food-library-mobile-row')
    expect(row).toHaveTextContent('Alpha Bar')
    expect(row).toHaveTextContent('Acme')
    expect(row).toHaveTextContent('1 bar (50 g)')
    expect(row).toHaveTextContent('200 kcal')
    expect(row).toHaveTextContent('4.00 kcal/g')
  })

  it('opens the edit dialog when a card is tapped', async () => {
    stubViewport(true)
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([food({ id: 'a', name: 'Alpha Bar' })])
    renderPage()

    const row = await screen.findByTestId('food-library-mobile-row')
    fireEvent.click(row)

    // FoodItemDialog renders <Modal title="Edit food">; Modal sets aria-label={title}
    // on the native <dialog>, so the dialog's accessible name is "Edit food".
    expect(await screen.findByRole('dialog', { name: 'Edit food' })).toBeInTheDocument()
  })

  it('exposes per-card Edit/Delete actions via the kebab', async () => {
    stubViewport(true)
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([food({ id: 'a', name: 'Alpha Bar' })])
    renderPage()

    await screen.findByTestId('food-library-mobile-row')
    const kebab = screen.getByRole('button', { name: 'Options for Alpha Bar' })
    fireEvent.click(kebab)

    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete from library' })).toBeInTheDocument()
  })

  it('offers a mobile Sort by control that reorders the cards', async () => {
    stubViewport(true)
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([
      food({ id: 'a', name: 'Almonds', calories_per_serving: 200 }),
      food({ id: 'b', name: 'Bagel', calories_per_serving: 280 }),
    ])
    renderPage()

    await screen.findByTestId('food-library-mobile-list')
    const select = screen.getByRole('combobox', { name: /sort foods by/i })
    expect(within(select).getByRole('option', { name: 'Name' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Calories' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Fat' })).toBeInTheDocument()

    // Default sort is name ascending: Almonds before Bagel.
    let rows = screen.getAllByTestId('food-library-mobile-row')
    expect(rows[0]).toHaveTextContent('Almonds')

    fireEvent.change(select, { target: { value: 'calories' } })

    // Calories defaults to descending: Bagel (280) before Almonds (200).
    rows = screen.getAllByTestId('food-library-mobile-row')
    expect(rows[0]).toHaveTextContent('Bagel')
    expect(rows[1]).toHaveTextContent('Almonds')
  })

  it('shows a compact macro line on cards only when Show macros is enabled', async () => {
    stubViewport(true)
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([
      food({ id: 'a', name: 'Alpha Bar', protein_grams: 10, carbs_grams: 25, fat_grams: 8 }),
    ])
    renderPage()

    let row = await screen.findByTestId('food-library-mobile-row')
    expect(row).not.toHaveTextContent('P 10g')

    fireEvent.click(screen.getByRole('switch', { name: /show macros/i }))

    row = screen.getByTestId('food-library-mobile-row')
    expect(row).toHaveTextContent('P 10g, C 25g, F 8g')
  })

  it('shows density in the selected unit on cards', async () => {
    stubViewport(true)
    vi.mocked(fetchFoodItems).mockResolvedValueOnce([
      food({ id: 'a', name: 'Dense Bar', serving_weight_grams: 50, calories_per_serving: 200 }),
    ])
    renderPage()

    expect(await screen.findByText('4.00 kcal/g')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('oz'))

    expect(await screen.findByText('113.4 kcal/oz')).toBeInTheDocument()
    expect(screen.queryByText('4.00 kcal/g')).toBeNull()
  })
})
