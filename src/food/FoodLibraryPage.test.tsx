// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import type { FoodItem } from '../lib/types'
import { MobilePrimaryNavProvider } from '../layout/mobile-primary-nav-context'

// jsdom has no matchMedia; the page reads it via useIsMobile() (max-width:
// 767px) to switch between the desktop table and the mobile card list.
// stubViewport(true) makes that query match so the card list renders.
function stubViewport(mobile: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: mobile && query.includes('767px'),
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

// jsdom has no native <dialog> support; Modal opens via showModal().
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true }
  HTMLDialogElement.prototype.close = function close() { this.open = false }
})

// Mock the data layer: the page reads fetchFoodItems and the action hook's
// mutations. We only exercise rendering / search / sort / macros / empty here,
// so the mutations can be inert.
const h = vi.hoisted(() => ({
  fetchFoodItems: vi.fn<() => Promise<FoodItem[]>>(),
  importFoodItems: vi.fn(),
  downloadCsv: vi.fn(),
}))
vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return {
    ...actual,
    fetchFoodItems: h.fetchFoodItems,
    importFoodItems: h.importFoodItems,
  }
})
// Stub only downloadCsv (it drives a real anchor-click download);
// foodItemsToCsv/parseFoodCsv stay real so the tests exercise the actual
// format round-trip.
vi.mock('../lib/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/csv')>()
  return { ...actual, downloadCsv: h.downloadCsv }
})
import { foodItemsToCsv } from '../lib/csv'
vi.mock('./use-food-item-actions', () => ({
  useFoodItemActions: () => ({
    addItem: { mutate: vi.fn(), isPending: false, error: null },
    editItem: { mutate: vi.fn(), isPending: false, error: null },
    removeItem: { mutate: vi.fn(), isPending: false, error: null },
  }),
}))

import FoodLibraryPage from './FoodLibraryPage'

afterEach(cleanup)

function food(over: Partial<FoodItem> = {}): FoodItem {
  return {
    id: crypto.randomUUID(),
    name: 'Ramen',
    brand: null,
    servingDescription: null,
    servingWeightGrams: 85,
    caloriesPerServing: 380,
    servingsPerPackage: null,
    fatGrams: null,
    saturatedFatGrams: null,
    carbsGrams: null,
    fiberGrams: null,
    sugarGrams: null,
    proteinGrams: null,
    sodiumMg: null,
    potassiumMg: null,
    notes: null,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/food']}>
        <MobilePrimaryNavProvider>{children}</MobilePrimaryNavProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(<FoodLibraryPage />, { wrapper })
}

function rowNames(): string[] {
  const table = screen.getByRole('table', { name: 'Food library' })
  return within(table)
    .getAllByRole('row')
    .slice(1) // drop the header row
    .map((r) => {
      // The name is the first cell's font-medium div (brand sits below it in
      // the same cell, so read the name node directly, not the cell text).
      const cell = within(r).getAllByRole('cell')[0]
      const nameEl = cell?.querySelector('.font-medium')
      return (nameEl?.textContent ?? '').trim()
    })
}

describe('FoodLibraryPage', () => {
  it('renders one Foods route heading', async () => {
    h.fetchFoodItems.mockResolvedValue([food()])
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Foods' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('searchbox', { name: 'Search foods' })).toBeTruthy()
  })

  it('renders the empty state when there are no foods', async () => {
    h.fetchFoodItems.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No foods yet')).toBeTruthy()
  })

  it('renders rows and the count', async () => {
    h.fetchFoodItems.mockResolvedValue([
      food({ name: 'Ramen', brand: 'Maruchan' }),
      food({ name: 'Oats' }),
    ])
    renderPage()
    await screen.findByRole('table', { name: 'Food library' })
    expect(screen.getByText('2 foods')).toBeTruthy()
    expect(screen.getByText('Maruchan')).toBeTruthy()
  })

  it('search filters on name and brand', async () => {
    h.fetchFoodItems.mockResolvedValue([
      food({ name: 'Ramen', brand: 'Maruchan' }),
      food({ name: 'Oats', brand: 'Quaker' }),
    ])
    renderPage()
    await screen.findByRole('table', { name: 'Food library' })

    const search = screen.getByPlaceholderText('Search foods by name or brand')
    fireEvent.change(search, { target: { value: 'quaker' } })
    await waitFor(() => expect(rowNames()).toEqual(['Oats']))

    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(await screen.findByText(/No foods match/)).toBeTruthy()
  })

  it('sorts by calories when the header is clicked', async () => {
    h.fetchFoodItems.mockResolvedValue([
      food({ name: 'Low', caloriesPerServing: 100 }),
      food({ name: 'High', caloriesPerServing: 500 }),
    ])
    renderPage()
    await screen.findByRole('table', { name: 'Food library' })
    // Default sort is name asc: High before Low.
    expect(rowNames()).toEqual(['High', 'Low'])

    // Click Calories -> desc first (highest first).
    fireEvent.click(screen.getByRole('button', { name: /Calories/ }))
    await waitFor(() => expect(rowNames()).toEqual(['High', 'Low']))

    // Click again -> asc (lowest first).
    fireEvent.click(screen.getByRole('button', { name: /Calories/ }))
    await waitFor(() => expect(rowNames()).toEqual(['Low', 'High']))
  })

  it('the macros toggle reveals the macro columns', async () => {
    h.fetchFoodItems.mockResolvedValue([food({ name: 'Ramen', proteinGrams: 8 })])
    renderPage()
    await screen.findByRole('table', { name: 'Food library' })
    expect(screen.queryByText('Protein')).toBeNull()

    fireEvent.click(screen.getByLabelText('Show macros'))
    expect(screen.getByText('Protein')).toBeTruthy()
    expect(screen.getByText('8.0 g')).toBeTruthy()
  })

  it('renders the mobile card list (not the table) below the md breakpoint', async () => {
    stubViewport(true)
    h.fetchFoodItems.mockResolvedValue([food({ name: 'Ramen', brand: 'Maruchan' })])
    renderPage()
    // The card list is a <ul> labelled "Food library"; the desktop <table>
    // must NOT be mounted (only one renders at a time).
    const list = await screen.findByRole('list', { name: 'Food library' })
    expect(within(list).getByText('Ramen')).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Food library' })).toBeNull()
    // New food is reachable on mobile: the in-content button plus the bottom
    // bar's Add slot both carry that accessible name.
    expect(screen.getAllByRole('button', { name: /New food/ }).length).toBeGreaterThanOrEqual(1)
  })
})

describe('FoodLibraryPage CSV import/export', () => {
  it('exports the library as the canonical CSV via the Options menu', async () => {
    const items = [
      food({ name: 'Ramen', brand: 'Maruchan', sodiumMg: 0 }),
      food({ name: 'Oats' }),
    ]
    h.fetchFoodItems.mockResolvedValue(items)
    renderPage()
    await screen.findByRole('table', { name: 'Food library' })

    // getByTitle: the mobile bar's Options slot shares the accessible name
    // (jsdom doesn't apply the lg:hidden split); only the desktop popover
    // trigger carries the title attribute.
    fireEvent.click(screen.getByTitle('Food options'))
    fireEvent.click(await screen.findByRole('button', { name: 'Export to CSV' }))
    // Sorted rows are a VIEW concern; the export writes library order.
    expect(h.downloadCsv).toHaveBeenCalledWith('food-library.csv', foodItemsToCsv(items))
  })

  it('imports a picked CSV: parse -> preview -> confirm -> POST -> refetch', async () => {
    h.fetchFoodItems.mockResolvedValue([])
    h.importFoodItems.mockResolvedValue({ createdItems: 1 })
    const { container } = renderPage()
    await screen.findByText('No foods yet')

    const input = container.querySelector('input[type="file"]')
    expect(input).not.toBeNull()
    const file = new File(
      ['name,serving_weight_grams,calories_per_serving\r\nOats,50,100'],
      'foods.csv',
      { type: 'text/csv' },
    )
    fireEvent.change(input!, { target: { files: [file] } })

    // The preview dialog opens once FileReader + parseFoodCsv settle.
    const importBtn = await screen.findByRole('button', { name: /import 1 food/i })
    fireEvent.click(importBtn)

    await waitFor(() => expect(h.importFoodItems).toHaveBeenCalledTimes(1))
    expect(h.importFoodItems.mock.calls[0]?.[0]).toMatchObject([
      { name: 'Oats', servingWeightGrams: 50, caloriesPerServing: 100 },
    ])
    // Create-only import invalidates ['food-items'] (and nothing else - no
    // plan references brand-new foods), so the page refetches.
    await waitFor(() =>
      expect(h.fetchFoodItems.mock.calls.length).toBeGreaterThanOrEqual(2),
    )
  })
})
