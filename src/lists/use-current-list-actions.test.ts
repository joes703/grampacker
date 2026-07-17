// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { mutationErrorHandler } from '../lib/mutation-error-handler'
import { useCurrentListActions } from './use-current-list-actions'
import { showToast } from '../lib/toast'
import type { List } from '../lib/types'

// TRANSPLANT NOTE (csv): the old repo's suite also covered exportCsv
// (exportingListId lifecycle + failure toast); those cases return with the
// CSV slice.

// Hoisted spies so both the mock factories and the test bodies share the same
// fn instances. (vi.mock is hoisted above imports; vi.hoisted lets the
// factories close over these.)
const q = vi.hoisted(() => ({
  updateList: vi.fn(),
  duplicateList: vi.fn(),
  deleteList: vi.fn(),
  createList: vi.fn(),
  // Faithful (content-dependent) reimplementation of the real
  // nextListSortOrder: max(sortOrder) + 1 + offset. The createListMut
  // lifecycle test relies on this returning DIFFERENT values for the
  // pre-insert cache vs. the post-insert cache - a constant stub would mask
  // the ordering regression it guards against.
  nextListSortOrder: vi.fn((existing: { sortOrder: number }[], offset = 0) => {
    let max = -1
    for (const l of existing) if (l.sortOrder > max) max = l.sortOrder
    return max + 1 + offset
  }),
}))
// Faithful placeholder: carries the passed sortOrder onto the optimistic row
// so the REAL makeOptimisticInsert appends a row whose sortOrder the
// lifecycle test can observe.
const placeholder = vi.hoisted(() => ({
  optimisticListPlaceholder: vi.fn(
    ({ name, sortOrder }: { name: string; sortOrder: number }) => ({
      id: `temp-${sortOrder}`,
      name,
      sortOrder,
      isDraft: true,
    }),
  ),
}))
const navigateSpy = vi.hoisted(() => vi.fn())

// MemoryRouter renders a real navigator; swap useNavigate for a spy so the
// createListMut tests can assert the post-success navigation target. Keep the
// rest of react-router intact (the hook only uses useNavigate).
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>()
  return { ...actual, useNavigate: () => navigateSpy }
})

vi.mock('../lib/toast', () => ({ showToast: vi.fn() }))

// COMPLETE mock of the queries barrel so the real network-facing fetchers are
// never loaded. EXCEPTION: the makeOptimistic* helpers come from the REAL
// `../lib/queries/optimistic` module, imported directly (it only depends on
// react-query types and the toast module, which is mocked). Going through the
// real optimistic-insert lifecycle is load-bearing for the createListMut test:
// a stubbed makeOptimisticInsert would never insert the placeholder, so it
// could not catch the onMutate-before-mutationFn ordering regression where
// the placeholder's slot ends up one position too high.
vi.mock('../lib/queries', async () => {
  const optimistic = await import('../lib/queries/optimistic')
  return {
    queryKeys: {
      lists: () => ['lists'],
      listItems: (id: string) => ['list-items', id],
      categories: () => ['categories'],
      foodPlans: () => ['food-plans'],
      foodPlanAll: () => ['food-plan'],
    },
    updateList: q.updateList,
    duplicateList: q.duplicateList,
    deleteList: q.deleteList,
    createList: q.createList,
    makeOptimisticUpdate: optimistic.makeOptimisticUpdate,
    makeOptimisticDelete: optimistic.makeOptimisticDelete,
    makeOptimisticInsert: optimistic.makeOptimisticInsert,
    nextListSortOrder: q.nextListSortOrder,
  }
})

vi.mock('../lib/optimistic-list-placeholder', () => ({
  optimisticListPlaceholder: placeholder.optimisticListPlaceholder,
}))

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

// Expose the per-render QueryClient so createListMut tests can seed the
// ['lists'] cache the optimistic callback reads at mutation time.
let lastQc: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  lastQc = qc
  // useNavigate is mocked to a spy, so no router provider is needed.
  return createElement(QueryClientProvider, { client: qc }, children)
}

describe('useCurrentListActions - duplicate', () => {
  beforeEach(() => {
    vi.mocked(showToast).mockClear()
    q.duplicateList.mockReset()
    navigateSpy.mockClear()
  })
  afterEach(() => cleanup())

  it('duplicates by id, invalidates, and navigates to the server row', async () => {
    q.duplicateList.mockResolvedValueOnce({ ...LIST, id: 'copy-id' })
    const { result } = renderHook(() => useCurrentListActions(), { wrapper })
    // Seed the plan summaries so their invalidation is observable: the server
    // deep-copies the source list's plan (one plan per trip), so the Plans
    // index gained a card this cache doesn't know about.
    lastQc.setQueryData(['food-plans'], [])
    act(() => { result.current.duplicateMut.mutate(LIST) })
    await waitFor(() => expect(q.duplicateList).toHaveBeenCalledWith('l1'))
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/lists/copy-id'))
    expect(lastQc.getQueryState(['food-plans'])?.isInvalidated).toBe(true)
  })

  it('toasts when duplicateList rejects', async () => {
    q.duplicateList.mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useCurrentListActions(), { wrapper })
    act(() => { result.current.duplicateMut.mutate(LIST) })
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Couldn't duplicate that list. Please try again.", { type: 'error' }),
    )
  })
})

// The list's name and existence are denormalized into the food-plan caches
// (usedByListName on summaries, usedByLists on documents), so rename and
// delete must invalidate both or a stale Plans index keeps saying "In use by"
// a renamed/deleted list.
describe('useCurrentListActions - food-plan cache invalidation', () => {
  beforeEach(() => {
    q.updateList.mockReset()
    q.deleteList.mockReset()
  })
  afterEach(() => cleanup())

  function seedPlanCaches() {
    lastQc.setQueryData(['lists'], [LIST])
    lastQc.setQueryData(['food-plans'], [])
    lastQc.setQueryData(['food-plan', 'p1'], { id: 'p1' })
  }

  it('rename invalidates plan summaries and documents', async () => {
    q.updateList.mockResolvedValueOnce({ ...LIST, name: 'Renamed' })
    const { result } = renderHook(() => useCurrentListActions(), { wrapper })
    seedPlanCaches()
    act(() => { result.current.renameMut.mutate({ id: 'l1', name: 'Renamed' }) })
    await waitFor(() => expect(result.current.renameMut.isSuccess).toBe(true))
    expect(lastQc.getQueryState(['food-plans'])?.isInvalidated).toBe(true)
    expect(lastQc.getQueryState(['food-plan', 'p1'])?.isInvalidated).toBe(true)
  })

  it('delete invalidates plan summaries and documents', async () => {
    q.deleteList.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useCurrentListActions(), { wrapper })
    seedPlanCaches()
    act(() => { result.current.deleteListMut.mutate('l1') })
    await waitFor(() => expect(result.current.deleteListMut.isSuccess).toBe(true))
    expect(lastQc.getQueryState(['food-plans'])?.isInvalidated).toBe(true)
    expect(lastQc.getQueryState(['food-plan', 'p1'])?.isInvalidated).toBe(true)
  })
})

describe('useCurrentListActions - createListMut', () => {
  beforeEach(() => {
    q.createList.mockReset()
    q.nextListSortOrder.mockClear()
    placeholder.optimisticListPlaceholder.mockClear()
    vi.mocked(showToast).mockClear()
    navigateSpy.mockClear()
  })
  afterEach(() => cleanup())

  it('snapshots the append slot BEFORE the optimistic insert pollutes the cache (real onMutate lifecycle)', async () => {
    // Regression guard for the ordering bug: makeOptimisticInsert.onMutate
    // appends the optimistic placeholder to the ['lists'] cache BEFORE
    // mutationFn runs. Recomputing the slot after that point would count the
    // placeholder and land one position too high. This test runs the REAL
    // optimistic-insert lifecycle (not a stub), so it exercises that ordering:
    // the placeholder for a [0,1] cache must be built with sortOrder 2,
    // never 3. (The server assigns the persisted slot from its own max+1;
    // only the placeholder consumes this value in the rewrite.)
    q.createList.mockResolvedValueOnce({ ...LIST, id: 'new-id', name: 'New' })
    const { result } = renderHook(() => useCurrentListActions(), { wrapper })
    // Seed two lists at sortOrder 0 and 1; the append position is 2.
    const seeded: List[] = [
      { ...LIST, id: 'a', sortOrder: 0 },
      { ...LIST, id: 'b', sortOrder: 1 },
    ]
    act(() => { lastQc.setQueryData(['lists'], seeded) })

    act(() => { result.current.submitCreateList('New') })

    await waitFor(() => expect(q.createList).toHaveBeenCalled())
    // The optimistic placeholder was built with sortOrder 2 (not 3)...
    expect(placeholder.optimisticListPlaceholder).toHaveBeenCalledWith({
      name: 'New',
      sortOrder: 2,
    })
    // ...and the server write carries only the name.
    expect(q.createList).toHaveBeenCalledWith('New')
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/lists/new-id'))
  })

  it('does not navigate when createList rejects', async () => {
    q.createList.mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useCurrentListActions(), { wrapper })
    act(() => { result.current.submitCreateList('New') })
    await waitFor(() => expect(result.current.createListMut.isError).toBe(true))
    expect(showToast).toHaveBeenCalledWith("Couldn't create the list. Please try again.", { type: 'error' })
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})
