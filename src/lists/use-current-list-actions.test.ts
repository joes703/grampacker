// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
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
  fetchListItems: vi.fn(),
  fetchCategories: vi.fn(),
  nextListSortOrder: vi.fn(() => 0),
}))
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
  fetchListItems: q.fetchListItems,
  fetchCategories: q.fetchCategories,
  // The optimistic-update factories are only spread into useMutation options;
  // returning empty options is enough for these tests (the mutations under
  // test are non-optimistic).
  makeOptimisticUpdate: vi.fn(() => ({})),
  makeOptimisticDelete: vi.fn(() => ({})),
  nextListSortOrder: q.nextListSortOrder,
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

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return createElement(QueryClientProvider, { client: qc }, createElement(MemoryRouter, null, children))
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
