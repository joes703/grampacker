// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryKeys } from '../lib/queries'
import type { FoodItem } from '../lib/types'
import type { FoodPatch } from './FoodItemDialog'

// Stub only the network calls; keep the real queryKeys + optimistic helpers,
// so the settled invalidation under test is the real lifecycle.
const h = vi.hoisted(() => ({
  createFoodItem: vi.fn<(data: FoodPatch) => Promise<FoodItem>>(),
  updateFoodItem: vi.fn<(id: string, patch: FoodPatch) => Promise<FoodItem>>(),
  deleteFoodItem: vi.fn<(id: string) => Promise<void>>(),
}))
vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return {
    ...actual,
    createFoodItem: h.createFoodItem,
    updateFoodItem: h.updateFoodItem,
    deleteFoodItem: h.deleteFoodItem,
  }
})

import { useFoodItemActions } from './use-food-item-actions'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function food(id: string, over: Partial<FoodItem> = {}): FoodItem {
  return {
    id,
    name: id,
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

const patch: FoodPatch = {
  name: 'Oats',
  brand: null,
  servingDescription: null,
  servingWeightGrams: 90,
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
}

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const existing = food('f1')
  qc.setQueryData(queryKeys.foodItems(), [existing])
  // A previously-visited public share whose weight includes this food. The
  // share's weight is SERVER-computed (slice 5), so serving-weight edits and
  // deletes (whose entries cascade away) make it stale in a way the client
  // cannot re-derive - design 5.5: food mutations invalidate ['shared-list'].
  qc.setQueryData(queryKeys.sharedList('abc123'), {
    list: { name: 'Trip', description: null, groupWorn: false, isDraft: false },
    categories: [],
    items: [],
    food: { weightGrams: 100, incomplete: false },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useFoodItemActions([existing]), {
    wrapper,
  })
  return { qc, result }
}

const shareState = (qc: QueryClient) =>
  qc.getQueryState(queryKeys.sharedList('abc123'))

describe('useFoodItemActions share-cache invalidation', () => {
  it('editItem invalidates the share cache on settle', async () => {
    h.updateFoodItem.mockResolvedValue(food('f1', { servingWeightGrams: 90 }))
    const { qc, result } = setup()

    result.current.editItem.mutate({ id: 'f1', patch })

    await waitFor(() => expect(shareState(qc)?.isInvalidated).toBe(true))
  })

  it('removeItem invalidates the share cache on settle', async () => {
    h.deleteFoodItem.mockResolvedValue()
    const { qc, result } = setup()

    result.current.removeItem.mutate('f1')

    await waitFor(() => expect(shareState(qc)?.isInvalidated).toBe(true))
  })

  it('addItem does NOT touch the share cache - a new food is in no plan', async () => {
    h.createFoodItem.mockResolvedValue(food('f2'))
    const { qc, result } = setup()

    result.current.addItem.mutate(patch)

    await waitFor(() => expect(h.createFoodItem).toHaveBeenCalled())
    // Settled invalidation of the primary cache proves the lifecycle ran...
    await waitFor(() =>
      expect(qc.getQueryState(queryKeys.foodItems())?.isInvalidated).toBe(true),
    )
    // ...and the share cache stayed untouched.
    expect(shareState(qc)?.isInvalidated).toBe(false)
  })
})
