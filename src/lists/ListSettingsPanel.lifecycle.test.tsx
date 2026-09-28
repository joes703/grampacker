// @vitest-environment jsdom

// ListSettingsPanel against the REAL useCurrentListActions, a real router and a
// real QueryClient, inside a harness that does what ListDetailPage does: render
// the panel only while its list is in ['lists'], and "List not found" otherwise.
// That swap is what unmounts the panel mid-delete, and an unmounted mutation
// observer drops per-call callbacks - which the mocked-hook suite beside this
// one cannot show.

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MutationCache, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router'
import { mutationErrorHandler } from '../lib/mutation-error-handler'
import { showToast } from '../lib/toast'
import type { List } from '../lib/types'

const q = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  updateList: vi.fn(),
  duplicateList: vi.fn(),
  deleteList: vi.fn(),
}))

vi.mock('../lib/toast', () => ({ showToast: vi.fn() }))
vi.mock('./PrivacyPanel', () => ({ default: () => <div>sharing controls</div> }))

// Network fetchers mocked; the optimistic helpers are the real ones, so the
// delete really removes the row (and rolls it back) the way the app does.
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
    createList: vi.fn(),
    fetchListItems: vi.fn(),
    fetchCategories: vi.fn(),
    makeOptimisticUpdate: optimistic.makeOptimisticUpdate,
    makeOptimisticDelete: optimistic.makeOptimisticDelete,
    makeOptimisticInsert: optimistic.makeOptimisticInsert,
    nextListSortOrder: vi.fn(() => 0),
  }
})

import ListSettingsPanel from './ListSettingsPanel'

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.open = false }
  }
})

beforeEach(() => {
  for (const spy of Object.values(q)) spy.mockReset()
  vi.mocked(showToast).mockClear()
})

afterEach(cleanup)

const LIST: List = {
  id: 'l1',
  name: 'Trip',
  description: null,
  slug: 'trip',
  isShared: false,
  isDraft: false,
  sortOrder: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// ListDetailPage's shape, reduced: the panel exists only while its list does.
// `popover` mimics the desktop host, which unmounts the panel when it closes;
// without it the host stays mounted, like the mobile Modal.
function ListRoute({ popover }: { popover: boolean }) {
  const { id } = useParams()
  const [open, setOpen] = useState(true)
  const { data } = useQuery({ queryKey: ['lists'], queryFn: q.fetchLists, staleTime: Infinity })
  const list = data?.find((l: List) => l.id === id)
  if (!list) return <p>List not found</p>
  if (popover && !open) return <p>popover closed</p>
  return <ListSettingsPanel list={list} onClose={() => setOpen(false)} />
}

function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

function renderAt(path: string, { popover = false } = {}) {
  const qc = new QueryClient({
    mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  qc.setQueryData(['lists'], [LIST])
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/lists" element={<p>All lists</p>} />
          <Route path="/lists/:id" element={<ListRoute popover={popover} />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return qc
}

async function confirmDelete() {
  await userEvent.click(screen.getByRole('button', { name: 'Delete list' }))
  const confirm = screen.getByRole('dialog', { name: 'Delete list' })
  await userEvent.click(within(confirm).getByRole('button', { name: 'Delete list' }))
}

describe('ListSettingsPanel delete, through the real hook', () => {
  it('ends on /lists after a successful delete, not on "List not found"', async () => {
    const request = deferred<void>()
    q.deleteList.mockReturnValueOnce(request.promise)
    q.fetchLists.mockResolvedValue([])
    renderAt('/lists/l1')

    await confirmDelete()
    await act(async () => { request.resolve() })

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/lists$/))
    expect(screen.getByText('All lists')).toBeInTheDocument()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('rolls back and toasts on /lists when the delete fails', async () => {
    const request = deferred<void>()
    q.deleteList.mockReturnValueOnce(request.promise)
    q.fetchLists.mockResolvedValue([LIST])
    const qc = renderAt('/lists/l1')

    await confirmDelete()
    await act(async () => { request.reject(new Error('nope')) })

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't confirm that list was deleted. Refresh to check before trying again.",
        { type: 'error' },
      ),
    )
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/lists$/)
    expect(qc.getQueryData<List[]>(['lists'])?.map((l) => l.id)).toEqual(['l1'])
  })
})

describe('ListSettingsPanel duplicate, through the real hook', () => {
  it('still opens the copy when the desktop popover closed on the click', async () => {
    const request = deferred<List>()
    q.duplicateList.mockReturnValueOnce(request.promise)
    q.fetchLists.mockResolvedValue([LIST, { ...LIST, id: 'copy-id' }])
    renderAt('/lists/l1', { popover: true })

    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(screen.getByText('popover closed')).toBeInTheDocument()
    await act(async () => { request.resolve({ ...LIST, id: 'copy-id' }) })

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/lists\/copy-id$/))
  })
})

describe('ListSettingsPanel rename, through the real hook', () => {
  it('reports a failed rename inline while the mobile Modal keeps the panel mounted', async () => {
    q.updateList.mockRejectedValueOnce(new Error('nope'))
    q.fetchLists.mockResolvedValue([LIST])
    renderAt('/lists/l1')

    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'List name' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Summit{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't confirm the new name was saved. Please try again.",
    )
    expect(showToast).not.toHaveBeenCalled()
  })
})
