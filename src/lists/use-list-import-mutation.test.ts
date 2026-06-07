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
  importListFromCsv: vi.fn(),
  nextListSortOrder: vi.fn(() => 7),
  // The hook resolves inventory via fetchQuery, so these query fns are what
  // it ultimately calls (when the cache is cold/stale). Tests drive them.
  fetchLists: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
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
  importListFromCsv: q.importListFromCsv,
  nextListSortOrder: q.nextListSortOrder,
  fetchLists: q.fetchLists,
  fetchGearItems: q.fetchGearItems,
  fetchCategories: q.fetchCategories,
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

const GEAR: GearItem = {
  id: 'g1',
  user_id: 'u1',
  name: 'Tent',
  description: null,
  weight_grams: 1000,
  category_id: 'c1',
  status: 'active',
  cost: null,
  purchase_date: null,
  sort_order: 0,
  created_at: '',
  updated_at: '',
}

const CAT: Category = {
  id: 'c1',
  user_id: 'u1',
  name: 'Shelter',
  is_default: false,
  sort_order: 0,
  created_at: '',
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

let lastQc: QueryClient

// Default wrapper: staleTime 0 (react-query default), so fetchQuery always
// resolves through the mocked query fns - this models the cold-cache path.
function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  lastQc = qc
  return createElement(QueryClientProvider, { client: qc }, children)
}

// Warm wrapper: staleTime Infinity so seeded cache is fresh and fetchQuery
// returns it WITHOUT calling the query fn (models a warm page).
function warmWrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false, staleTime: Infinity },
    },
  })
  lastQc = qc
  return createElement(QueryClientProvider, { client: qc }, children)
}

describe('useListImportMutation', () => {
  beforeEach(() => {
    q.importListFromCsv.mockReset().mockResolvedValue(undefined)
    q.nextListSortOrder.mockClear().mockReturnValue(7)
    // Sensible defaults so fetchQuery resolves in every test; individual
    // tests override to assert the resolved values flow through.
    q.fetchLists.mockReset().mockResolvedValue([])
    q.fetchGearItems.mockReset().mockResolvedValue([])
    q.fetchCategories.mockReset().mockResolvedValue([])
    navigateSpy.mockClear()
  })
  afterEach(() => cleanup())

  it('resolves inventory, imports atomically, invalidates, and navigates (happy path)', async () => {
    const lists: List[] = [{ ...LIST, id: 'a', sort_order: 0 }]
    const gearItems: GearItem[] = [GEAR]
    const categories: Category[] = [CAT]
    q.fetchLists.mockResolvedValue(lists)
    q.fetchGearItems.mockResolvedValue(gearItems)
    q.fetchCategories.mockResolvedValue(categories)
    q.importListFromCsv.mockResolvedValueOnce({ ...LIST, id: 'L1' })

    const { result } = renderHook(() => useListImportMutation('u1'), { wrapper })
    const invalidateSpy = vi.spyOn(lastQc, 'invalidateQueries')

    act(() => { result.current.mutate({ name: 'Imported', rows: ROWS }) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(q.nextListSortOrder).toHaveBeenCalledWith(lists)
    // sortOrder is whatever nextListSortOrder returns in this test (mocked 7).
    expect(q.importListFromCsv).toHaveBeenCalledWith('u1', 'Imported', ROWS, gearItems, categories, 7)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['lists'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['gear-items'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['categories'] })
    expect(navigateSpy).toHaveBeenCalledWith('/lists/L1')
  })

  it('fetches inventory when the cache is cold - never preflights or dedups against []', async () => {
    // No setQueryData: the caches are empty (cold page). The hook MUST fetch
    // the real inventory via fetchQuery, not fall back to empty arrays, or it
    // would dedup imported gear against [] and create duplicates.
    q.fetchGearItems.mockResolvedValue([GEAR])
    q.fetchCategories.mockResolvedValue([CAT])
    q.fetchLists.mockResolvedValue([])
    q.importListFromCsv.mockResolvedValueOnce({ ...LIST, id: 'L1' })

    const { result } = renderHook(() => useListImportMutation('u1'), { wrapper })
    act(() => { result.current.mutate({ name: 'Imported', rows: ROWS }) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // The fetched, non-empty inventory flows into importListFromCsv (which
    // owns the cap preflight and dedup) - the structural guarantee against [].
    expect(q.fetchGearItems).toHaveBeenCalledWith('u1')
    expect(q.fetchCategories).toHaveBeenCalledWith('u1')
    expect(q.importListFromCsv).toHaveBeenCalledWith('u1', 'Imported', ROWS, [GEAR], [CAT], 7)
  })

  it('uses warm cache without refetching when data is fresh', async () => {
    const lists: List[] = [{ ...LIST, id: 'a' }]
    q.importListFromCsv.mockResolvedValueOnce({ ...LIST, id: 'L1' })

    const { result } = renderHook(() => useListImportMutation('u1'), { wrapper: warmWrapper })
    act(() => {
      lastQc.setQueryData(['lists'], lists)
      lastQc.setQueryData(['gear-items'], [GEAR])
      lastQc.setQueryData(['categories'], [CAT])
    })

    act(() => { result.current.mutate({ name: 'Imported', rows: ROWS }) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // staleTime Infinity: fetchQuery returns the seeded cache and never calls
    // the network query fns.
    expect(q.fetchLists).not.toHaveBeenCalled()
    expect(q.fetchGearItems).not.toHaveBeenCalled()
    expect(q.fetchCategories).not.toHaveBeenCalled()
    // The cached inventory still flows through to importListFromCsv.
    expect(q.importListFromCsv).toHaveBeenCalledWith('u1', 'Imported', ROWS, [GEAR], [CAT], 7)
  })

  it('surfaces an over-cap rejection and does not navigate', async () => {
    // The cap preflight now lives inside importListFromCsv; an over-cap import
    // rejects there. The hook must surface that as isError and not navigate.
    q.importListFromCsv.mockRejectedValueOnce(new Error('over cap'))

    const { result } = renderHook(() => useListImportMutation('u1'), { wrapper })
    act(() => { result.current.mutate({ name: 'Imported', rows: ROWS }, { onError: () => {} }) })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(navigateSpy).not.toHaveBeenCalled()
  })

  it('surfaces a generic import error and does not navigate', async () => {
    q.importListFromCsv.mockRejectedValueOnce(new Error('import failed'))

    const { result } = renderHook(() => useListImportMutation('u1'), { wrapper })
    act(() => { result.current.mutate({ name: 'Imported', rows: ROWS }, { onError: () => {} }) })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(q.importListFromCsv).toHaveBeenCalled()
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})
