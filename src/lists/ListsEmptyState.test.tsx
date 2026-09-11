// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MutationCache, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { mutationErrorHandler } from '../lib/mutation-error-handler'
import { queryKeys } from '../lib/queries/keys'
import { showToast } from '../lib/toast'
import type { List } from '../lib/types'

// The defining lifecycle of this surface: the optimistic placeholder makes
// the lists array non-empty, the parent stops rendering the empty state, and
// the component that owned the inline error is gone before the server
// answers. A failure then had NO surface at all - a known gap since the
// failure-feedback rule was written. The toast is what survives the unmount.

const q = vi.hoisted(() => ({ createList: vi.fn() }))
vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, createList: q.createList }
})
vi.mock('../lib/toast', () => ({ showToast: vi.fn() }))

import ListsEmptyState, { CREATE_FAILED_COPY } from './ListsEmptyState'

// Mirrors ListsPage's switch: the empty state renders only while the lists
// cache is empty.
function Parent() {
  const { data: lists = [] } = useQuery<List[]>({
    queryKey: queryKeys.lists(),
    queryFn: () => Promise.resolve([]),
  })
  return lists.length === 0 ? <ListsEmptyState /> : <div>lists page</div>
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ListsEmptyState create failure', () => {
  it('reports through the global toast after the placeholder has unmounted it', async () => {
    let reject: (err: Error) => void = () => {}
    q.createList.mockReturnValue(
      new Promise<List>((_resolve, rej) => {
        reject = rej
      }),
    )
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    })
    qc.setQueryData(queryKeys.lists(), [])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Parent />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await userEvent.type(screen.getByPlaceholderText('e.g. PCT thru-hike'), 'Sierra')
    await userEvent.click(screen.getByRole('button', { name: /create/i }))
    // The placeholder landed and the empty state is gone - the inline error
    // owner no longer exists.
    await screen.findByText('lists page')
    expect(screen.queryByPlaceholderText('e.g. PCT thru-hike')).toBeNull()

    reject(new Error('boom'))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(CREATE_FAILED_COPY, { type: 'error' })
    })
    // Rolled back: the placeholder is gone and the empty state is back.
    await screen.findByPlaceholderText('e.g. PCT thru-hike')
    expect(qc.getQueryData(queryKeys.lists())).toEqual([])
    warn.mockRestore()
  })
})
