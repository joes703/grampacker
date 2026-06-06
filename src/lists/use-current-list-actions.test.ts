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
  // nextListSortOrder returns the append position; the createListMut tests
  // assert it is called and that createList receives whatever it returns.
  nextListSortOrder: vi.fn(() => 7),
}))
const placeholder = vi.hoisted(() => ({ optimisticListPlaceholder: vi.fn(() => ({})) }))
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
vi.mock('../lib/queries', () => ({
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
  // The optimistic-update/insert/delete factories are only spread into
  // useMutation options; returning empty options is enough for these tests
  // (the mutations under test are non-optimistic from the helper's POV).
  makeOptimisticUpdate: vi.fn(() => ({})),
  makeOptimisticDelete: vi.fn(() => ({})),
  makeOptimisticInsert: vi.fn(() => ({})),
  nextListSortOrder: q.nextListSortOrder,
}))

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
    q.nextListSortOrder.mockClear().mockReturnValue(7)
    navigateSpy.mockClear()
  })
  afterEach(() => cleanup())

  it('creates with cache-derived sort order and navigates to the new list', async () => {
    q.createList.mockResolvedValueOnce({ ...LIST, id: 'new-id', name: 'New' })
    const { result } = renderHook(() => useCurrentListActions('u1'), { wrapper })
    // Seed the lists cache the mutationFn reads at mutation time.
    const seeded: List[] = [
      { ...LIST, id: 'a', sort_order: 0 },
      { ...LIST, id: 'b', sort_order: 1 },
    ]
    act(() => { lastQc.setQueryData(['lists'], seeded) })

    act(() => { result.current.createListMut.mutate('New') })

    await waitFor(() => expect(q.createList).toHaveBeenCalled())
    // nextListSortOrder is called with the seeded cache; createList receives
    // (userId, name, <its return>).
    expect(q.nextListSortOrder).toHaveBeenCalledWith(seeded)
    expect(q.createList).toHaveBeenCalledWith('u1', 'New', 7)
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/lists/new-id'))
  })

  it('does not navigate when createList rejects', async () => {
    q.createList.mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useCurrentListActions('u1'), { wrapper })
    act(() => { result.current.createListMut.mutate('New') })
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
