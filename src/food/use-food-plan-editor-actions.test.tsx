// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryKeys, type FoodPlanDocument } from '../lib/queries'
import type { AddEntryRequestInput } from '../../shared/food-plans'

// Stub only the network calls; keep the real queryKeys.
const h = vi.hoisted(() => ({
  addFoodPlanEntry:
    vi.fn<(planId: string, input: AddEntryRequestInput) => Promise<FoodPlanDocument>>(),
}))
vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return {
    ...actual,
    addFoodPlanEntry: h.addFoodPlanEntry,
  }
})

import { useFoodPlanEditorActions } from './use-food-plan-editor-actions'

afterEach(cleanup)

function doc(id: string): FoodPlanDocument {
  return {
    id,
    name: id,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    meals: [],
    days: [],
    dayMeals: [],
    entries: [],
    usedByList: null,
  }
}

// Every editor mutation funnels through the same onDoc success handler, so
// one mutation exercises the contract for all eight.
describe('useFoodPlanEditorActions cache writes', () => {
  it('writes the returned document, refreshes summaries, and invalidates the share cache', async () => {
    const fresh = doc('p1')
    h.addFoodPlanEntry.mockResolvedValue(fresh)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(queryKeys.foodPlans(), [])
    // A previously-visited public share of the list this plan backs. Its
    // weight is a SERVER-computed number (slice 5), so an entry edit makes
    // it stale in a way no client-side derivation can heal - design 5.5
    // requires entry mutations to invalidate the ['shared-list'] prefix
    // (staleTime is 30s; without this, revisiting the share inside that
    // window serves the old total from cache).
    qc.setQueryData(queryKeys.sharedList('abc123'), {
      list: { name: 'Trip', description: null, groupWorn: false, isDraft: false },
      categories: [],
      items: [],
      food: { weightGrams: 100, incomplete: false },
    })

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useFoodPlanEditorActions('p1'), {
      wrapper,
    })

    result.current.addEntry.mutate({
      isExtra: true,
      dayMealId: null,
      foodItemId: 'f1',
      basis: 'servings',
      amount: 1,
    })

    await waitFor(() =>
      expect(qc.getQueryData(queryKeys.foodPlan('p1'))).toEqual(fresh),
    )
    expect(qc.getQueryState(queryKeys.foodPlans())?.isInvalidated).toBe(true)
    expect(
      qc.getQueryState(queryKeys.sharedList('abc123'))?.isInvalidated,
    ).toBe(true)
  })
})
