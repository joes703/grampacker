// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { mutationErrorHandler } from '../lib/mutation-error-handler'
import { useCurrentListActions } from './use-current-list-actions'
import { showToast } from '../lib/toast'
import type { List } from '../lib/types'

// Hoisted spies so both the mock factories and the test bodies share the same
// fn instances. (vi.mock is hoisted above imports; vi.hoisted lets the
// factories close over these.)
const q = vi.hoisted(() => ({
  updateList: vi.fn(),
  duplicateList: vi.fn(),
  deleteList: vi.fn(),
  createList: vi.fn(),
  fetchListItems: vi.fn(),
  fetchCategories: vi.fn(),
  // Faithful (content-dependent) reimplementation of the real
  // nextListSortOrder: max(sort_order) + 1 + offset. The createListMut
  // lifecycle test relies on this returning DIFFERENT values for the
  // pre-insert cache vs. the post-insert cache - a constant stub would mask
  // the ordering regression it guards against.
  nextListSortOrder: vi.fn((existing: { sort_order: number }[], offset = 0) => {
    let max = -1
    for (const l of existing) if (l.sort_order > max) max = l.sort_order
    return max + 1 + offset
  }),
}))
// Faithful placeholder: carries the passed sort_order onto the optimistic row
// so the REAL makeOptimisticInsert appends a row whose sort_order the
// lifecycle test can observe.
const placeholder = vi.hoisted(() => ({
  optimisticListPlaceholder: vi.fn(
    ({ name, userId, sortOrder }: { name: string; userId: string; sortOrder: number }) => ({
      id: `temp-${sortOrder}`,
      user_id: userId,
      name,
      sort_order: sortOrder,
      is_draft: true,
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
const csv = vi.hoisted(() => ({
  listItemsToCsv: vi.fn(() => 'csv'),
  downloadCsv: vi.fn(),
}))

vi.mock('../lib/toast', () => ({ showToast: vi.fn() }))

// COMPLETE mock of the queries barrel. A partial mock (spreading the real
// module via importOriginal) would evaluate `../lib/queries`, which pulls in
// bulk-reorder -> supabase.ts and throws "Missing required environment
// variable: VITE_SUPABASE_URL" under CI (no .env). Mock every symbol
// useCurrentListActions imports so the real barrel is never loaded.
//
// EXCEPTION: the makeOptimistic* helpers come from the REAL
// `../lib/queries/optimistic` module, imported directly (it is supabase-free -
// it only depends on react-query types and the toast module, which is mocked).
// Going through the real optimistic-insert lifecycle is load-bearing for the
// createListMut test: a stubbed makeOptimisticInsert would never insert the
// placeholder, so it could not catch the onMutate-before-mutationFn ordering
// regression where the persisted sort_order ends up one position too high.
vi.mock('../lib/queries', async () => {
  const optimistic = await import('../lib/queries/optimistic')
  return {
    queryKeys: {
      lists: () => ['lists'],
      listItems: (id: string) => ['list-items', id],
      categories: () => ['categories'],
    },
    updateList: q.updateList,
    duplicateList: q.duplicateList,
    deleteList: q.deleteList,
    createList: q.createList,
    fetchListItems: q.fetchListItems,
    fetchCategories: q.fetchCategories,
    makeOptimisticUpdate: optimistic.makeOptimisticUpdate,
    makeOptimisticDelete: optimistic.makeOptimisticDelete,
    makeOptimisticInsert: optimistic.makeOptimisticInsert,
    nextListSortOrder: q.nextListSortOrder,
  }
})

vi.mock('../lib/optimistic-list-placeholder', () => ({
  optimisticListPlaceholder: placeholder.optimisticListPlaceholder,
}))

vi.mock('../lib/csv', () => ({ listItemsToCsv: csv.listItemsToCsv, downloadCsv: csv.downloadCsv }))

const LIST: List = {
  id: 'l1',
  user_id: 'u1',
  name: 'Trip',
  description: null,
  slug: 'abc123',
  is_shared: false,
  is_draft: false,
  group_worn: false,
  ready_checks_enabled: false,
  sort_order: 0,
  created_at: '',
  updated_at: '',
}

// Expose the per-render QueryClient so createListMut tests can seed the
// ['lists'] cache the mutationFn / optimistic callback read at mutation time.
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

describe('useCurrentListActions - duplicate failure feedback', () => {
  beforeEach(() => { vi.mocked(showToast).mockClear() })
  afterEach(() => cleanup())

  it('toasts when duplicateList rejects', async () => {
    q.duplicateList.mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useCurrentListActions('u1'), { wrapper })
    act(() => { result.current.duplicateMut.mutate(LIST) })
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Couldn't duplicate that list. Please try again.", { type: 'error' }),
    )
  })
})

describe('useCurrentListActions - createListMut', () => {
  beforeEach(() => {
    q.createList.mockReset()
    q.nextListSortOrder.mockClear()
    placeholder.optimisticListPlaceholder.mockClear()
    navigateSpy.mockClear()
  })
  afterEach(() => cleanup())

  it('persists the same append sort_order it shows optimistically (real onMutate -> mutationFn lifecycle)', async () => {
    // Regression guard for the b-ordering bug: makeOptimisticInsert.onMutate
    // appends the optimistic placeholder to the ['lists'] cache BEFORE
    // mutationFn runs. A mutationFn that re-reads the cache would see that
    // placeholder and compute an append position one too high, so the persisted
    // sort_order would NOT match the one shown optimistically. This test runs
    // the REAL optimistic-insert lifecycle (not a stub), so it exercises that
    // ordering: the value handed to createList must equal the placeholder's
    // sort_order (2 for a [0,1] cache), never 3.
    q.createList.mockResolvedValueOnce({ ...LIST, id: 'new-id', name: 'New' })
    const { result } = renderHook(() => useCurrentListActions('u1'), { wrapper })
    // Seed two lists at sort_order 0 and 1; the append position is 2.
    const seeded: List[] = [
      { ...LIST, id: 'a', sort_order: 0 },
      { ...LIST, id: 'b', sort_order: 1 },
    ]
    act(() => { lastQc.setQueryData(['lists'], seeded) })

    act(() => { result.current.submitCreateList('New') })

    await waitFor(() => expect(q.createList).toHaveBeenCalled())
    // The optimistic placeholder was built with sort_order 2...
    expect(placeholder.optimisticListPlaceholder).toHaveBeenCalledWith({
      name: 'New',
      userId: 'u1',
      sortOrder: 2,
    })
    // ...and the persisted write MUST use that same 2, not 3.
    expect(q.createList).toHaveBeenCalledWith('u1', 'New', 2)
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/lists/new-id'))
  })

  it('does not navigate when createList rejects', async () => {
    q.createList.mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useCurrentListActions('u1'), { wrapper })
    act(() => { result.current.submitCreateList('New') })
    await waitFor(() => expect(result.current.createListMut.isError).toBe(true))
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})

describe('useCurrentListActions - exportCsv failure feedback', () => {
  beforeEach(() => {
    vi.mocked(showToast).mockClear()
    csv.downloadCsv.mockClear()
  })
  afterEach(() => cleanup())

  it('toasts and does not download when the fetch rejects', async () => {
    q.fetchListItems.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useCurrentListActions('u1'), { wrapper })
    await act(async () => { await result.current.exportCsv(LIST) })
    expect(showToast).toHaveBeenCalledWith("Couldn't export the list. Please try again.", { type: 'error' })
    expect(csv.downloadCsv).not.toHaveBeenCalled()
  })
})
