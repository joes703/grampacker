// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { mutationErrorHandler } from '../lib/mutation-error-handler'
import { useCurrentListActions } from './use-current-list-actions'
import { showToast } from '../lib/toast'
import { readLastListPath, writeLastListPath } from '../lib/last-list-path'
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

// Keep the real optimistic and sort helpers; mock only data transport.
vi.mock('../lib/queries', async () => {
  const optimistic = await import('../lib/queries/optimistic')
  const { nextListSortOrder } = await import('../lib/queries/sort-keys')
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
    nextListSortOrder,
  }
})

const LIST: List = {
  id: 'l1',
  name: 'Trip',
  description: null,
  slug: 'abc123',
  isShared: false,
  isDraft: false,
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
    const invalidate = vi.spyOn(lastQc, 'invalidateQueries')
    act(() => { result.current.duplicateMut.mutate(LIST) })
    await waitFor(() => expect(q.duplicateList).toHaveBeenCalledWith('l1'))
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/lists/copy-id'))
    // The refetch must already be running when the copy's page first renders,
    // or it flashes "List not found" (the copy is not in ['lists'] yet).
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['lists'] })
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(navigateSpy.mock.invocationCallOrder[0]!)
  })

  it('toasts refresh-first copy and still invalidates when duplicateList rejects', async () => {
    // A rejection does not prove the copy was not made, so ['lists'] is refetched
    // and the copy advises checking before a retry makes a second one.
    q.duplicateList.mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useCurrentListActions(), { wrapper })
    const invalidate = vi.spyOn(lastQc, 'invalidateQueries')
    act(() => { result.current.duplicateMut.mutate(LIST) })
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't confirm the list was duplicated. Refresh to check before trying again.",
        { type: 'error' },
      ),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['lists'] })
    expect(navigateSpy).not.toHaveBeenCalled()
  })

  it('invalidates and navigates even when the caller unmounted before the response', async () => {
    // The caller can be gone by the time the copy lands (the user moved on). Only
    // hook-level callbacks survive an unmount, so the success path must live
    // there, not in a per-call onSuccess.
    let resolve!: (row: List) => void
    q.duplicateList.mockReturnValueOnce(new Promise<List>((r) => { resolve = r }))
    const { result, unmount } = renderHook(() => useCurrentListActions(), { wrapper })
    const invalidate = vi.spyOn(lastQc, 'invalidateQueries')
    act(() => { result.current.duplicateMut.mutate(LIST) })
    unmount()
    await act(async () => { resolve({ ...LIST, id: 'copy-id' }) })
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/lists/copy-id'))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['lists'] })
  })
})

describe('useCurrentListActions - deleteListMut', () => {
  beforeEach(() => {
    vi.mocked(showToast).mockClear()
    q.deleteList.mockReset()
    localStorage.clear()
  })
  afterEach(() => cleanup())

  // The last-list pointer only stores strict /lists/<uuid> paths.
  const DELETED = '11111111-1111-4111-8111-111111111111'
  const OTHER = '22222222-2222-4222-8222-222222222222'

  it('forgets the last-list pointer to the deleted list, even after the caller unmounted', async () => {
    // Deleting the open list navigates away on the click, so the list page's own
    // self-heal never sees it missing; without this, RootRedirect would follow
    // the pointer into "List not found".
    writeLastListPath(`/lists/${DELETED}/pack`, 'owner-1')
    let resolve!: () => void
    q.deleteList.mockReturnValueOnce(new Promise<void>((r) => { resolve = r }))
    const { result, unmount } = renderHook(() => useCurrentListActions(), { wrapper })

    act(() => { result.current.deleteListMut.mutate(DELETED) })
    unmount()
    await act(async () => { resolve() })

    await waitFor(() => expect(readLastListPath('owner-1')).toBeNull())
  })

  it('keeps a pointer to another list (the successor the user moved to)', async () => {
    writeLastListPath(`/lists/${OTHER}`, 'owner-1')
    q.deleteList.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useCurrentListActions(), { wrapper })

    act(() => { result.current.deleteListMut.mutate(DELETED) })

    await waitFor(() => expect(q.deleteList).toHaveBeenCalled())
    await waitFor(() => expect(result.current.deleteListMut.isSuccess).toBe(true))
    expect(readLastListPath('owner-1')).toBe(`/lists/${OTHER}`)
  })

  it('keeps the pointer when the delete fails, since the list is still there', async () => {
    writeLastListPath(`/lists/${DELETED}`, 'owner-1')
    q.deleteList.mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useCurrentListActions(), { wrapper })

    act(() => { result.current.deleteListMut.mutate(DELETED) })

    await waitFor(() => expect(result.current.deleteListMut.isError).toBe(true))
    expect(readLastListPath('owner-1')).toBe(`/lists/${DELETED}`)
  })

  it('toasts when the delete fails, through the REAL optimistic helper', async () => {
    // This one runs against the actual makeOptimisticDelete rather than a mock, so
    // it proves the whole path - option -> rollback -> toast - not just that a
    // string reached a spy.
    //
    // Why a list delete earns a toast at all (the rule in
    // src/lib/mutation-error-handler.ts): every call site closes its confirm before
    // mutating, and the two that delete the open list leave it on the click, so a
    // failure is the list silently back in the sidebar or on /lists. Nothing in
    // that sequence reads as "the delete failed".
    q.deleteList.mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useCurrentListActions(), { wrapper })

    act(() => { result.current.deleteListMut.mutate(LIST.id) })

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't confirm that list was deleted. Refresh to check before trying again.",
        { type: 'error' },
      ),
    )
  })

  it('says nothing when the delete succeeds', async () => {
    q.deleteList.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useCurrentListActions(), { wrapper })

    act(() => { result.current.deleteListMut.mutate(LIST.id) })

    // `mutationFn: deleteList` is passed by reference, so TanStack hands it the
    // variables AND its own mutation context as a second argument.
    await waitFor(() => expect(q.deleteList).toHaveBeenCalledWith(LIST.id, expect.anything()))
    expect(showToast).not.toHaveBeenCalled()
  })
})

describe('useCurrentListActions - createListMut', () => {
  beforeEach(() => {
    q.createList.mockReset()
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
    let finish: (row: List) => void = () => {}
    q.createList.mockReturnValueOnce(new Promise<List>((resolve) => { finish = resolve }))
    const { result } = renderHook(() => useCurrentListActions(), { wrapper })
    // Seed two lists at sortOrder 0 and 1; the append position is 2.
    const seeded: List[] = [
      { ...LIST, id: 'a', sortOrder: 0 },
      { ...LIST, id: 'b', sortOrder: 1 },
    ]
    act(() => { lastQc.setQueryData(['lists'], seeded) })

    act(() => { result.current.submitCreateList('New') })

    await waitFor(() => expect(q.createList).toHaveBeenCalled())
    // Observe the real placeholder while the request is pending.
    expect(lastQc.getQueryData<List[]>(['lists'])?.find((row) => row.name === 'New'))
      .toMatchObject({ name: 'New', sortOrder: 2, isDraft: true })
    // ...and the server write carries only the name.
    expect(q.createList).toHaveBeenCalledWith('New')
    await act(async () => { finish({ ...LIST, id: 'new-id', name: 'New' }) })
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/lists/new-id'))
  })

  it('does not navigate when createList rejects, and the toast does not claim nothing was created', async () => {
    q.createList.mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useCurrentListActions(), { wrapper })
    act(() => { result.current.submitCreateList('New') })
    await waitFor(() => expect(result.current.createListMut.isError).toBe(true))
    // A rejected response does not prove the non-idempotent POST did not
    // commit (AGENTS.md "Traps"), so the copy must advise checking before a
    // retry, not invite one.
    expect(showToast).toHaveBeenCalledWith(
      "Couldn't confirm the list was created. Refresh to check before trying again.",
      { type: 'error' },
    )
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})

describe('useCurrentListActions - exportCsv', () => {
  beforeEach(() => {
    vi.mocked(showToast).mockClear()
    q.fetchListItems.mockReset()
    q.fetchCategories.mockReset()
  })
  afterEach(() => cleanup())

  // The export is fired without await from a menu, so a failure must be
  // reported and consumed here, and the row's spinner must stop. Otherwise
  // the user sees a spinner that never ends and no reason why.
  it('marks the list as exporting, then on failure toasts and stops the spinner', async () => {
    let failItems: (error: Error) => void = () => {}
    q.fetchListItems.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { failItems = reject }),
    )
    q.fetchCategories.mockResolvedValueOnce([])
    const { result } = renderHook(() => useCurrentListActions(), { wrapper })

    let done: Promise<void> = Promise.resolve()
    act(() => { done = result.current.exportCsv(LIST) })
    await waitFor(() => expect(result.current.exportingListId).toBe('l1'))
    expect(q.fetchListItems).toHaveBeenCalledWith('l1')

    await act(async () => {
      failItems(new Error('offline'))
      await expect(done).resolves.toBeUndefined()
    })

    expect(result.current.exportingListId).toBeNull()
    expect(showToast).toHaveBeenCalledWith(
      "Couldn't export the list. Please try again.",
      { type: 'error' },
    )
  })
})
