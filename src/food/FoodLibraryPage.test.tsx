// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock the queries barrel: the real module pulls in the Supabase client,
// which throws at import without env vars. Provide just what the page reads.
vi.mock('../lib/queries', () => ({
  queryKeys: { foodItems: () => ['food-items'] as const },
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
import FoodLibraryPage from './FoodLibraryPage'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

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
