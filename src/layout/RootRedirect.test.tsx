// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, useParams } from 'react-router'
import type { List } from '../lib/types'

// Mock the two inputs RootRedirect reads: the cached-path helper and the
// lists fetch. queryKeys stays real so the useQuery key matches nothing
// unexpected.
vi.mock('../lib/last-list-path', () => ({ readLastListPath: vi.fn() }))
vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  fetchLists: vi.fn(),
}))

import { readLastListPath } from '../lib/last-list-path'
import { fetchLists } from '../lib/queries'
import RootRedirect from './RootRedirect'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function makeList(over: Partial<List>): List {
  return {
    id: 'list-1',
    name: 'Trip',
    description: null,
    slug: 'abc123',
    foodPlanId: null,
    isShared: false,
    groupWorn: false,
    readyChecksEnabled: false,
    isDraft: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

// Renders RootRedirect at `/` and a set of probe routes that each print
// their path, so the assertions read the resolved destination.
function renderAt() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/lists" element={<div>lists-page</div>} />
          <Route path="/lists/:id" element={<Probe />} />
          <Route path="/lists/:id/pack" element={<div>pack-page</div>} />
          <Route path="/lists/:id/organize" element={<div>organize-page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function Probe() {
  const { id } = useParams()
  return <div>detail:{id}</div>
}

describe('RootRedirect', () => {
  it('shows a loading landmark while the list redirect is unresolved', () => {
    vi.mocked(readLastListPath).mockReturnValue(null)
    vi.mocked(fetchLists).mockReturnValue(new Promise(() => {}))
    renderAt()

    expect(screen.getByRole('status', { name: 'Loading your lists...' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  it('fast path: redirects to the cached last-list path without fetching', async () => {
    vi.mocked(readLastListPath).mockReturnValue(
      '/lists/11111111-1111-1111-1111-111111111111/pack',
    )
    renderAt()

    await waitFor(() => expect(screen.getByText('pack-page')).toBeInTheDocument())
    // The cache short-circuit means fetchLists is never called.
    expect(fetchLists).not.toHaveBeenCalled()
  })

  it('fast path: restores the peer Organize mode', async () => {
    vi.mocked(readLastListPath).mockReturnValue(
      '/lists/11111111-1111-1111-1111-111111111111/organize',
    )
    renderAt()

    await waitFor(() => expect(screen.getByText('organize-page')).toBeInTheDocument())
    expect(fetchLists).not.toHaveBeenCalled()
  })

  it('slow path: no cache -> redirects to the most-recently-updated list', async () => {
    vi.mocked(readLastListPath).mockReturnValue(null)
    vi.mocked(fetchLists).mockResolvedValue([
      makeList({ id: 'older', updatedAt: '2026-01-01T00:00:00Z' }),
      makeList({ id: 'newest', updatedAt: '2026-03-01T00:00:00Z' }),
      makeList({ id: 'middle', updatedAt: '2026-02-01T00:00:00Z' }),
    ])
    renderAt()

    // The detail route surfaces its :id param, so this asserts the reduce
    // actually picked the max-by-updatedAt list, not merely that some
    // list was chosen.
    await waitFor(() => expect(screen.getByText('detail:newest')).toBeInTheDocument())
    expect(fetchLists).toHaveBeenCalledTimes(1)
  })

  it('empty account: zero lists -> redirects to the lists empty state', async () => {
    vi.mocked(readLastListPath).mockReturnValue(null)
    vi.mocked(fetchLists).mockResolvedValue([])
    renderAt()

    await waitFor(() => expect(screen.getByText('lists-page')).toBeInTheDocument())
  })

  it('failed fetch (no cache) -> redirects to /lists instead of a blank page', async () => {
    vi.mocked(readLastListPath).mockReturnValue(null)
    vi.mocked(fetchLists).mockRejectedValue(new Error('network down'))
    renderAt()

    // The regression this pins: on error `lists` is undefined and
    // isLoading is false, so RootRedirect must fall through to /lists
    // (which owns the error UI) rather than returning null forever.
    await waitFor(() => expect(screen.getByText('lists-page')).toBeInTheDocument())
  })
})
