// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { mutationErrorHandler } from '../lib/mutation-error-handler'
import { useFoodPlanLink } from './use-food-plan-link'
import { ApiError } from '../lib/api'
import { showToast } from '../lib/toast'
import type { List } from '../lib/types'

// Cache-contract tests: every link mutation moves some plan's usedByList*
// (summaries) and usedByList (documents), so the ['food-plans'] and
// ['food-plan'] caches must be invalidated or a stale Plans index / picker
// offers the wrong action for a plan (e.g. "Duplicate & attach" for a plan
// that is actually free). These went untested when one-plan-per-trip landed
// and Codex flagged the resulting stale-summaries bug - keep them.

const q = vi.hoisted(() => ({
  attachFoodPlan: vi.fn(),
  detachFoodPlan: vi.fn(),
  duplicateFoodPlan: vi.fn(),
}))
// Real optimistic helpers + real key shapes; only the network fns are stubbed.
vi.mock('../lib/queries', async () => {
  const optimistic = await import('../lib/queries/optimistic')
  return {
    queryKeys: {
      lists: () => ['lists'],
      foodPlans: () => ['food-plans'],
      foodPlan: (id: string) => ['food-plan', id],
      foodPlanAll: () => ['food-plan'],
      sharedListAll: () => ['shared-list'],
      foodPackStateAll: () => ['food-pack'],
    },
    attachFoodPlan: q.attachFoodPlan,
    detachFoodPlan: q.detachFoodPlan,
    duplicateFoodPlan: q.duplicateFoodPlan,
    makeOptimisticUpdate: optimistic.makeOptimisticUpdate,
  }
})
vi.mock('../lib/toast', () => ({ showToast: vi.fn() }))

const LIST: List = {
  id: 'l1',
  name: 'Trip',
  description: null,
  slug: 'abc123',
  foodPlanId: null,
  isShared: false,
  isDraft: false,
  groupWorn: false,
  readyChecksEnabled: false,
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
}

let lastQc: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  lastQc = qc
  return createElement(QueryClientProvider, { client: qc }, children)
}

// Seed the caches whose freshness the mutations are responsible for, so
// isInvalidated is observable on each.
function seedCaches() {
  lastQc.setQueryData(['lists'], [LIST])
  lastQc.setQueryData(['food-plans'], [])
  lastQc.setQueryData(['food-plan', 'p1'], { id: 'p1' })
  // A populated checklist cache: every link mutation must invalidate it
  // (rule 1 cleared the rows server-side), through the ['food-pack'] prefix.
  lastQc.setQueryData(['food-pack', 'l1', 'p1'], ['f1'])
}

function invalidated(key: unknown[]): boolean {
  return lastQc.getQueryState(key)?.isInvalidated === true
}

afterEach(cleanup)
beforeEach(() => {
  vi.mocked(showToast).mockClear()
  q.attachFoodPlan.mockReset()
  q.detachFoodPlan.mockReset()
  q.duplicateFoodPlan.mockReset()
})

describe('useFoodPlanLink - attach', () => {
  it('invalidates the plan summaries and documents on success', async () => {
    q.attachFoodPlan.mockResolvedValueOnce({ ...LIST, foodPlanId: 'p1' })
    const { result } = renderHook(() => useFoodPlanLink(), { wrapper })
    seedCaches()
    act(() => { result.current.attachMut.mutate({ id: 'l1', foodPlanId: 'p1' }) })
    await waitFor(() => expect(result.current.attachMut.isSuccess).toBe(true))
    expect(invalidated(['food-plans'])).toBe(true)
    // ['food-plan'] is a prefix key: the cached document must be caught.
    expect(invalidated(['food-plan', 'p1'])).toBe(true)
    // Rule 1 cleared this list's pack state server-side. Invalidation is
    // not enough: invalidated data is still RENDERED while refetching, so
    // detach-then-reattach of the same plan could paint the old checkmarks
    // as phantom pre-checks. The entry must be REMOVED (prefix key - the
    // hook doesn't know which list's checklist is cached).
    expect(lastQc.getQueryState(['food-pack', 'l1', 'p1'])).toBeUndefined()
  })

  it('a 409 rolls back, toasts ONCE with the in-use message, and refetches summaries', async () => {
    q.attachFoodPlan.mockRejectedValueOnce(new ApiError(409, 'in use'))
    const { result } = renderHook(() => useFoodPlanLink(), { wrapper })
    seedCaches()
    act(() => { result.current.attachMut.mutate({ id: 'l1', foodPlanId: 'p1' }) })
    await waitFor(() => expect(result.current.attachMut.isError).toBe(true))
    // Optimistic write reverted: the list shows no plan again.
    const lists = lastQc.getQueryData<List[]>(['lists'])
    expect(lists?.[0]?.foodPlanId).toBeNull()
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith(
      'That plan is already used by another list.',
      { type: 'error' },
    )
    expect(invalidated(['food-plans'])).toBe(true)
  })

  it('other failures get the generic toast, still exactly one', async () => {
    q.attachFoodPlan.mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useFoodPlanLink(), { wrapper })
    seedCaches()
    act(() => { result.current.attachMut.mutate({ id: 'l1', foodPlanId: 'p1' }) })
    await waitFor(() => expect(result.current.attachMut.isError).toBe(true))
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith(
      "Couldn't attach that food plan. Please try again.",
      { type: 'error' },
    )
  })
})

describe('useFoodPlanLink - detach', () => {
  it('invalidates the plan summaries and documents on success', async () => {
    q.detachFoodPlan.mockResolvedValueOnce({ ...LIST, foodPlanId: null })
    const { result } = renderHook(() => useFoodPlanLink(), { wrapper })
    seedCaches()
    act(() => { result.current.detachMut.mutate('l1') })
    await waitFor(() => expect(result.current.detachMut.isSuccess).toBe(true))
    expect(invalidated(['food-plans'])).toBe(true)
    expect(invalidated(['food-plan', 'p1'])).toBe(true)
    // Removed, not invalidated - see the attach test.
    expect(lastQc.getQueryState(['food-pack', 'l1', 'p1'])).toBeUndefined()
  })
})

describe('useFoodPlanLink - duplicate & attach', () => {
  it('seeds the copy document and invalidates the replaced plan, summaries, and lists', async () => {
    const copyDoc = { id: 'copy', usedByList: { id: 'l1', name: 'Trip' } }
    q.duplicateFoodPlan.mockResolvedValueOnce(copyDoc)
    const { result } = renderHook(() => useFoodPlanLink(), { wrapper })
    seedCaches()
    act(() => {
      result.current.duplicateMut.mutate({
        planId: 'p-src',
        listId: 'l1',
        expectedFoodPlanId: 'p1',
      })
    })
    await waitFor(() => expect(result.current.duplicateMut.isSuccess).toBe(true))
    expect(q.duplicateFoodPlan).toHaveBeenCalledWith('p-src', 'l1', 'p1')
    expect(lastQc.getQueryData(['food-plan', 'copy'])).toEqual(copyDoc)
    // The replaced plan's document lost this list from usedByList.
    expect(invalidated(['food-plan', 'p1'])).toBe(true)
    expect(invalidated(['food-plans'])).toBe(true)
    expect(invalidated(['lists'])).toBe(true)
    // Removed, not invalidated - see the attach test.
    expect(lastQc.getQueryState(['food-pack', 'l1', 'p1'])).toBeUndefined()
  })

  it('a failed CAS refetches summaries and lists so the picker resyncs', async () => {
    q.duplicateFoodPlan.mockRejectedValueOnce(new ApiError(422, 'stale'))
    const { result } = renderHook(() => useFoodPlanLink(), { wrapper })
    seedCaches()
    act(() => {
      result.current.duplicateMut.mutate({
        planId: 'p-src',
        listId: 'l1',
        expectedFoodPlanId: null,
      })
    })
    await waitFor(() => expect(result.current.duplicateMut.isError).toBe(true))
    expect(invalidated(['food-plans'])).toBe(true)
    expect(invalidated(['lists'])).toBe(true)
  })
})
