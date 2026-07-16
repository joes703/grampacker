// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryKeys, type FoodPlanDocument } from '../lib/queries'

// Stub only the network call; keep the real queryKeys.
const h = vi.hoisted(() => ({
  duplicateFoodPlan:
    vi.fn<(id: string, listId: string | null) => Promise<FoodPlanDocument>>(),
}))
vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, duplicateFoodPlan: h.duplicateFoodPlan }
})

import { useFoodPlanEditorActions } from './use-food-plan-editor-actions'

afterEach(cleanup)

function doc(id: string, usedByLists: { id: string; name: string }[]): FoodPlanDocument {
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
    usedByLists,
  }
}

describe('useFoodPlanEditorActions.duplicate', () => {
  // The fork's blast radius is all cache bookkeeping: the copy must render
  // instantly from its seeded document, and the SOURCE document must not keep
  // claiming the forked list still uses it (the 12.9 warning reads that).
  it('seeds the copy and invalidates the source document', async () => {
    const source = doc('src', [
      { id: 'l1', name: 'Stays' },
      { id: 'l2', name: 'Forks' },
    ])
    const copy = doc('copy', [{ id: 'l2', name: 'Forks' }])
    h.duplicateFoodPlan.mockResolvedValue(copy)

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(queryKeys.foodPlan('src'), source)

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useFoodPlanEditorActions('src'), {
      wrapper,
    })

    result.current.duplicate.mutate('l2')

    // The copy's document is seeded so navigating there renders with no
    // loading flash.
    await waitFor(() =>
      expect(qc.getQueryData(queryKeys.foodPlan('copy'))).toEqual(copy),
    )
    expect(h.duplicateFoodPlan).toHaveBeenCalledWith('src', 'l2')
    // The source document is STALE, not gone: its usedByLists just shrank, and
    // serving the cached two-list version would re-show the shared-plan
    // warning for a list that already left.
    expect(
      qc.getQueryState(queryKeys.foodPlan('src'))?.isInvalidated,
    ).toBe(true)
    expect(
      qc.getQueryState(queryKeys.foodPlan('copy'))?.isInvalidated,
    ).toBe(false)
  })
})
