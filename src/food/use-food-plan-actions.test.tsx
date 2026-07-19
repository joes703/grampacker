// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryKeys, type FoodPlanDocument, type FoodPlanSummary } from '../lib/queries'

// Stub only the network calls; keep the real queryKeys + optimistic helpers.
const h = vi.hoisted(() => ({
  deleteFoodPlan: vi.fn<(id: string) => Promise<void>>(),
  duplicateFoodPlan:
    vi.fn<
      (
        id: string,
        listId: string | null,
        expectedFoodPlanId: string | null,
      ) => Promise<FoodPlanDocument>
    >(),
}))
vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return {
    ...actual,
    deleteFoodPlan: h.deleteFoodPlan,
    duplicateFoodPlan: h.duplicateFoodPlan,
  }
})

import { useFoodPlanActions } from './use-food-plan-actions'

afterEach(cleanup)

function summary(id: string): FoodPlanSummary {
  return {
    id,
    name: id,
    sortOrder: 0,
    dayCount: 1,
    entryCount: 0,
    usedByListId: null,
    usedByListName: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

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
    dailyTargets: [],
    mealTargets: [],
    usedByList: null,
  }
}

describe('useFoodPlanActions.duplicatePlan', () => {
  // The index's library duplicate: no list involved (listId and the CAS
  // expectation are both null), the copy's document is seeded so opening it
  // renders without a loading flash, and the summary list refetches so the
  // new card appears.
  it('seeds the copy document and refreshes the summaries', async () => {
    const copy = doc('copy')
    h.duplicateFoodPlan.mockResolvedValue(copy)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(queryKeys.foodPlans(), [summary('src')])

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useFoodPlanActions(), { wrapper })

    result.current.duplicatePlan.mutate('src')

    await waitFor(() =>
      expect(qc.getQueryData(queryKeys.foodPlan('copy'))).toEqual(copy),
    )
    expect(h.duplicateFoodPlan).toHaveBeenCalledWith('src', null, null)
    expect(qc.getQueryState(queryKeys.foodPlans())?.isInvalidated).toBe(true)
  })
})

describe('useFoodPlanActions.removePlan', () => {
  it('evicts the deleted plan from BOTH the summary list and its document cache', async () => {
    h.deleteFoodPlan.mockResolvedValue()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // Both caches populated: the index list and an already-opened plan document.
    qc.setQueryData(queryKeys.foodPlans(), [summary('p1'), summary('p2')])
    qc.setQueryData(queryKeys.foodPlan('p1'), doc('p1'))

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useFoodPlanActions(), { wrapper })

    result.current.removePlan.mutate('p1')

    // Document cache for the deleted plan is gone (regression: it used to
    // survive, so a back-nav would render a deleted plan from cache).
    await waitFor(() =>
      expect(qc.getQueryData(queryKeys.foodPlan('p1'))).toBeUndefined(),
    )
    // Summary row removed; the other plan is untouched.
    const summaries = qc.getQueryData<FoodPlanSummary[]>(queryKeys.foodPlans())
    expect(summaries?.map((s) => s.id)).toEqual(['p2'])
  })
})
