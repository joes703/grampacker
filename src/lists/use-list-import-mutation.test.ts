// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { mutationErrorHandler } from '../lib/mutation-error-handler'
import { useListImportMutation } from './use-list-import-mutation'
import type { List, GearItem, Category } from '../lib/types'
import type { ListImportRow } from '../lib/csv'

// Hoisted spies shared by the mock factories and the test bodies.
const q = vi.hoisted(() => ({
  createList: vi.fn(),
  importCsvRowsToList: vi.fn(),
  assertListImportWithinCaps: vi.fn(),
  nextListSortOrder: vi.fn(() => 7),
}))
const navigateSpy = vi.hoisted(() => vi.fn())

vi.mock('react-router', () => ({ useNavigate: () => navigateSpy }))

// COMPLETE mock of the queries barrel. A partial mock would evaluate the real
// barrel, which pulls in supabase.ts and throws on the missing
// VITE_SUPABASE_URL env var under CI. Mock every symbol the hook imports.
vi.mock('../lib/queries', () => ({
  queryKeys: {
    lists: () => ['lists'],
    gearItems: () => ['gear-items'],
    categories: () => ['categories'],
  },
  createList: q.createList,
  importCsvRowsToList: q.importCsvRowsToList,
  assertListImportWithinCaps: q.assertListImportWithinCaps,
  nextListSortOrder: q.nextListSortOrder,
}))

const LIST: List = {
  id: 'L1',
  user_id: 'u1',
  name: 'Imported',
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

const ROWS: ListImportRow[] = [
  {
    name: 'Tent',
    description: null,
    weight_grams: 1000,
    category: 'Shelter',
    quantity: 1,
    is_worn: false,
    is_consumable: false,
  },
]

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  lastQc = qc
  return createElement(QueryClientProvider, { client: qc }, children)
}

let lastQc: QueryClient

describe('useListImportMutation', () => {
  beforeEach(() => {
    q.createList.mockReset()
    q.importCsvRowsToList.mockReset()
    q.assertListImportWithinCaps.mockReset()
    q.nextListSortOrder.mockClear().mockReturnValue(7)
    navigateSpy.mockClear()
  })
  afterEach(() => cleanup())

  it('preflights caps, creates, populates, invalidates, and navigates (happy path)', async () => {
    const lists: List[] = [{ ...LIST, id: 'a', sort_order: 0 }]
    const gearItems: GearItem[] = []
    const categories: Category[] = []
    q.assertListImportWithinCaps.mockImplementation(() => {})
    q.createList.mockResolvedValueOnce({ ...LIST, id: 'L1' })
    q.importCsvRowsToList.mockResolvedValueOnce(undefined)

    const { result } = renderHook(() => useListImportMutation('u1'), { wrapper })
    act(() => {
      lastQc.setQueryData(['lists'], lists)
      lastQc.setQueryData(['gear-items'], gearItems)
      lastQc.setQueryData(['categories'], categories)
    })
    const invalidateSpy = vi.spyOn(lastQc, 'invalidateQueries')

    act(() => { result.current.mutate({ name: 'Imported', rows: ROWS }) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(q.assertListImportWithinCaps).toHaveBeenCalledWith(ROWS, gearItems, categories)
    expect(q.createList).toHaveBeenCalledWith('u1', 'Imported', 7)
    expect(q.nextListSortOrder).toHaveBeenCalledWith(lists)
    expect(q.importCsvRowsToList).toHaveBeenCalledWith('L1', 'u1', ROWS, gearItems, categories)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['lists'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['gear-items'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['categories'] })
    expect(navigateSpy).toHaveBeenCalledWith('/lists/L1')
  })

  it('preflight-before-write: when caps throw, no list is created or populated', async () => {
    q.assertListImportWithinCaps.mockImplementation(() => {
      throw new Error('over cap')
    })

    const { result } = renderHook(() => useListImportMutation('u1'), { wrapper })
    act(() => { result.current.mutate({ name: 'Imported', rows: ROWS }, { onError: () => {} }) })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(q.createList).not.toHaveBeenCalled()
    expect(q.importCsvRowsToList).not.toHaveBeenCalled()
    expect(navigateSpy).not.toHaveBeenCalled()
  })

  it('surfaces a generic populate error and does not navigate', async () => {
    q.assertListImportWithinCaps.mockImplementation(() => {})
    q.createList.mockResolvedValueOnce({ ...LIST, id: 'L1' })
    q.importCsvRowsToList.mockRejectedValueOnce(new Error('insert failed'))

    const { result } = renderHook(() => useListImportMutation('u1'), { wrapper })
    act(() => { result.current.mutate({ name: 'Imported', rows: ROWS }, { onError: () => {} }) })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(q.createList).toHaveBeenCalled()
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})
