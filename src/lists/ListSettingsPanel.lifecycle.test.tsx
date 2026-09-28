// @vitest-environment jsdom

// ListSettingsPanel against the REAL useCurrentListActions, a real router and a
// real QueryClient, inside a harness that does what ListDetailPage does: render
// the panel only while its list is in ['lists'], and "List not found" otherwise.
// That swap is what unmounts the panel mid-delete, and an unmounted mutation
// observer drops per-call callbacks - which the mocked-hook suite beside this
// one cannot show. The harness has none of the page's effects, including its
// last-list pointer self-heal; the pointer assertions below show the delete
// clears it without that page's help.

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MutationCache, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router'
import { mutationErrorHandler } from '../lib/mutation-error-handler'
import Modal from '../components/Modal'
import { readLastListPath, writeLastListPath } from '../lib/last-list-path'
import { showToast } from '../lib/toast'
import type { List } from '../lib/types'

const q = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  updateList: vi.fn(),
  duplicateList: vi.fn(),
  deleteList: vi.fn(),
  fetchListItems: vi.fn(),
  fetchCategories: vi.fn(),
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
    fetchListItems: q.fetchListItems,
    fetchCategories: q.fetchCategories,
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
  localStorage.clear()
})

afterEach(cleanup)

const LIST: List = {
  // A real UUID: the last-list pointer only stores strict /lists/<uuid> paths.
  id: '11111111-1111-4111-8111-111111111111',
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

// ListDetailPage's shape, reduced: the panel exists only while its list does,
// and sits in the mobile host - a real Modal that closes on the panel's
// onClose and keeps the panel mounted while closed.
function ListRoute() {
  const { id } = useParams()
  const [open, setOpen] = useState(true)
  const { data } = useQuery({ queryKey: ['lists'], queryFn: q.fetchLists, staleTime: Infinity })
  const list = data?.find((l: List) => l.id === id)
  if (!list) return <p>List not found</p>
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="List options">
      <ListSettingsPanel list={list} onClose={() => setOpen(false)} />
    </Modal>
  )
}

function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

function renderAt(path: string) {
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
          <Route path="/lists/:id" element={<ListRoute />} />
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
    writeLastListPath(`/lists/${LIST.id}`, 'owner-1')
    renderAt(`/lists/${LIST.id}`)

    await confirmDelete()
    await act(async () => { request.resolve() })

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/lists$/))
    expect(screen.getByText('All lists')).toBeInTheDocument()
    expect(showToast).not.toHaveBeenCalled()
    // Or `/` would follow it back into "List not found".
    await waitFor(() => expect(readLastListPath('owner-1')).toBeNull())
  })

  it('rolls back and toasts on /lists when the delete fails', async () => {
    const request = deferred<void>()
    q.deleteList.mockReturnValueOnce(request.promise)
    q.fetchLists.mockResolvedValue([LIST])
    writeLastListPath(`/lists/${LIST.id}`, 'owner-1')
    const qc = renderAt(`/lists/${LIST.id}`)

    await confirmDelete()
    await act(async () => { request.reject(new Error('nope')) })

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't confirm that list was deleted. Refresh to check before trying again.",
        { type: 'error' },
      ),
    )
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/lists$/)
    expect(qc.getQueryData<List[]>(['lists'])?.map((l) => l.id)).toEqual([LIST.id])
    expect(readLastListPath('owner-1')).toBe(`/lists/${LIST.id}`)
  })
})

describe('ListSettingsPanel rename, through the real hook', () => {
  it('reports a failed rename inline while the mobile Modal keeps the panel mounted', async () => {
    q.updateList.mockRejectedValueOnce(new Error('nope'))
    q.fetchLists.mockResolvedValue([LIST])
    renderAt(`/lists/${LIST.id}`)

    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'List name' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Summit{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't confirm the new name was saved. Please try again.",
    )
    expect(showToast).not.toHaveBeenCalled()
  })

  it('toasts a rename failure that lands after Export closed the Modal', async () => {
    // Tapping Export straight after typing commits the rename on blur, then
    // closes the Modal; the rename's inline report would be written into a
    // closed dialog, so it has to toast instead.
    const rename = deferred<List>()
    q.updateList.mockReturnValueOnce(rename.promise)
    q.fetchLists.mockResolvedValue([LIST])
    q.fetchListItems.mockReturnValue(new Promise(() => {}))
    q.fetchCategories.mockReturnValue(new Promise(() => {}))
    renderAt(`/lists/${LIST.id}`)

    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'List name' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Summit')
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(q.updateList).toHaveBeenCalledTimes(1)
    // Closed, but still mounted with the panel inside it.
    const host = document.querySelector<HTMLDialogElement>('dialog[aria-label="List options"]')
    expect(host?.open).toBe(false)
    expect(host).toHaveTextContent('Exporting…')

    await act(async () => { rename.reject(new Error('nope')) })

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't confirm the new name was saved. Please try again.",
        { type: 'error' },
      ),
    )
    expect(screen.queryByText("Couldn't confirm the new name was saved. Please try again.")).toBeNull()
  })
})
