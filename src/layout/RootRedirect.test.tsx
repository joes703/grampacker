// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, useParams } from 'react-router'
import type { List } from '../lib/types'

// A controllable session: RootRedirect reads authClient.useSession() only to
// get the owner id it scopes the cached-path read to. A rerender with a new
// value models signing in as a different account on the same browser.
const h = vi.hoisted(() => ({ data: null as { user: { id: string } } | null }))
vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: h.data, isPending: false }) },
}))

// last-list-path is deliberately REAL here (backed by real localStorage): the
// owner check it enforces is half of what these tests exist to prove, so a mock
// would let a cross-account regression pass. Only the network fetch is mocked.
vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  fetchLists: vi.fn(),
}))

import { writeLastListPath } from '../lib/last-list-path'
import { fetchLists } from '../lib/queries'
import RootRedirect from './RootRedirect'

const OWNER = 'user-a'
const CACHED_UUID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  localStorage.clear()
  h.data = { user: { id: OWNER } }
})

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
          <Route path="/lists/:id/food" element={<div>food-page</div>} />
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
    vi.mocked(fetchLists).mockReturnValue(new Promise(() => {}))
    renderAt()

    expect(screen.getByRole('status', { name: 'Loading your lists...' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  it('fast path: redirects to the cached last-list path without fetching', async () => {
    writeLastListPath(`/lists/${CACHED_UUID}/pack`, OWNER)
    renderAt()

    await waitFor(() => expect(screen.getByText('pack-page')).toBeInTheDocument())
    // The cache short-circuit means fetchLists is never called.
    expect(fetchLists).not.toHaveBeenCalled()
  })

  it('fast path: a stored food path restores to the food route', async () => {
    writeLastListPath(`/lists/${CACHED_UUID}/food`, OWNER)
    renderAt()

    await waitFor(() => expect(screen.getByText('food-page')).toBeInTheDocument())
    expect(fetchLists).not.toHaveBeenCalled()
  })

  it('cross-account: a pointer owned by A is IGNORED for account B', async () => {
    // The leak this whole change exists to close. A wrote the pointer; B signs
    // in on the same browser (a fresh document, or a lapsed cookie) with A's
    // pointer still in localStorage. RootRedirect must NOT follow it to A's list
    // URL - it falls through to the slow path and picks B's own most-recent list.
    writeLastListPath(`/lists/${CACHED_UUID}/pack`, 'account-A')
    h.data = { user: { id: 'account-B' } }
    vi.mocked(fetchLists).mockResolvedValue([
      makeList({ id: 'b-list', updatedAt: '2026-05-01T00:00:00Z' }),
    ])
    renderAt()

    // Fast path skipped: B lands on B's own list via a real fetch, never on
    // /lists/<A's uuid>/pack.
    await waitFor(() => expect(screen.getByText('detail:b-list')).toBeInTheDocument())
    expect(fetchLists).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('pack-page')).not.toBeInTheDocument()
  })

  it('slow path: no cache -> redirects to the most-recently-updated list', async () => {
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
    vi.mocked(fetchLists).mockResolvedValue([])
    renderAt()

    await waitFor(() => expect(screen.getByText('lists-page')).toBeInTheDocument())
  })

  it('failed fetch (no cache) -> redirects to /lists instead of a blank page', async () => {
    vi.mocked(fetchLists).mockRejectedValue(new Error('network down'))
    renderAt()

    // The regression this pins: on error `lists` is undefined and
    // isLoading is false, so RootRedirect must fall through to /lists
    // (which owns the error UI) rather than returning null forever.
    await waitFor(() => expect(screen.getByText('lists-page')).toBeInTheDocument())
  })
})
