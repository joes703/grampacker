// @vitest-environment jsdom
//
// The lists query on /lists/:id feeds two things that look identical when it
// fails: the terminal "List not found" state, and the last-list-path
// self-heal that clears the nav shortcut. Both keyed off `list === undefined`,
// and the `= []` default made a failed fetch produce exactly that. So one
// dropped connection told the user their list had been deleted AND forgot
// which list they were working in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { Category, GearItem, List, ListItemWithGear, PackingLocation } from '../lib/types'
import type { ListFoodResponse } from '../../shared/food'
import { MobilePrimaryNavProvider } from '../layout/mobile-primary-nav-context'
import { SidebarDrawerProvider } from '../layout/sidebar-drawer-context'
import { writeLastListPath, readLastListPath } from '../lib/last-list-path'
import { queryKeys, fetchLists } from '../lib/queries'

// The last-list pointer is owner-tagged: both ListDetailPage's write/self-heal
// and the test's own pointer setup must use the SAME account, or the self-heal
// would read a pointer it doesn't own and never clear it. A fixed session id
// makes the page's ownerId deterministic and matches OWNER below.
const OWNER = 'owner-1'
vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: OWNER } }, isPending: false }) },
}))

// Real UUID: writeLastListPath validates against a strict /lists/<uuid> regex
// and silently no-ops on anything else, so a placeholder id would make the
// self-heal assertions below pass vacuously.
const listId = '11111111-2222-4333-8444-555555555555'

const list = {
  id: listId,
  name: 'Sierra High Route',
  isShared: false,
  shareSlug: null,
  description: null,
  readyChecksEnabled: true,
  updatedAt: '2026-07-01T00:00:00.000Z',
} as unknown as List

const gear = {
  id: 'gear-1',
  name: 'Cooking pot',
  weightGrams: 210,
  categoryId: null,
} as unknown as GearItem

const listItem = {
  id: 'li-1',
  gearItemId: 'gear-1',
  gearItem: gear,
  quantity: 1,
  isWorn: false,
  isConsumable: false,
  isPacked: false,
  isReady: false,
  packingLocationId: null,
  sortOrder: 0,
} as unknown as ListItemWithGear

const emptyFood: ListFoodResponse = { dayCount: 0, slots: [], items: [] }

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
}))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

function stubViewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const m = /max-width:\s*(\d+)px/.exec(query)
    return {
      matches: m ? width <= Number(m[1]) : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }
  })
}

// seedLists pre-populates the ['lists'] cache so the page mounts with data
// already in hand, which is the only way to reach "cached collection defined
// but missing the route id". A failed refetch RETAINS the previous data, so it
// cannot produce that state on its own.
async function renderDetail(seedLists?: List[]) {
  const { default: ListDetailPage } = await import('./ListDetailPage')
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (seedLists) qc.setQueryData(queryKeys.lists(), seedLists)
  render(
    <QueryClientProvider client={qc}>
      <MobilePrimaryNavProvider>
        <SidebarDrawerProvider>
          <ListsQueryProbe />
          <MemoryRouter initialEntries={[`/lists/${listId}`]}>
            <Routes>
              <Route path="/lists/:id" element={<ListDetailPage />} />
            </Routes>
          </MemoryRouter>
        </SidebarDrawerProvider>
      </MobilePrimaryNavProvider>
    </QueryClientProvider>,
  )
  return qc
}

// An independent observer on the same query key, rendered beside the page.
// Waiting on qc.getQueryState is NOT sufficient: the cache transitions to
// 'error' before any React observer has re-rendered, so an assertion made
// there still inspects the pre-error DOM and would pass against the bug these
// tests exist to catch. Waiting until a RENDERED probe reports the new status
// is the same barrier the page itself has to cross, with no dependence on how
// many ticks the notification scheduler happens to take.
// It renders status AND fetchStatus because status alone cannot express the
// case the offline test exists for: 'success' covers both a settled collection
// and one whose refetch is parked offline, and it is specifically the parked
// one that used to read as a settled absence. Waiting on the pair asserts the
// state by name.
function ListsQueryProbe() {
  const { status, fetchStatus } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: fetchLists,
  })
  return <span data-testid="lists-status">{`${status}:${fetchStatus}`}</span>
}

async function failingRefetch(qc: QueryClient) {
  void qc.refetchQueries({ queryKey: queryKeys.lists() })
  await waitFor(() =>
    expect(screen.getByTestId('lists-status').textContent).toBe('error:idle'),
  )
}

beforeEach(() => {
  stubViewport(1280)
  localStorage.clear()
  h.fetchListItems.mockResolvedValue([listItem])
  h.fetchGearItems.mockResolvedValue([gear])
  h.fetchCategories.mockResolvedValue([] as Category[])
  h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
  h.fetchListFood.mockResolvedValue(emptyFood)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  // onlineManager is module-global; the offline test below would otherwise
  // pause every later query in this file.
  onlineManager.setOnline(true)
})

describe('ListDetailPage when the lists query fails', () => {
  it('renders a retryable failure state instead of "List not found"', async () => {
    h.fetchLists.mockRejectedValue(new Error('offline'))
    await renderDetail()

    await screen.findByText("Couldn't load your lists")
    expect(screen.queryByText('List not found')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('recovers the real page when Retry succeeds', async () => {
    h.fetchLists.mockRejectedValueOnce(new Error('offline'))
    await renderDetail()

    await screen.findByText("Couldn't load your lists")
    h.fetchLists.mockResolvedValue([list])
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    // Anchors on content that only exists past the detail loading gate. Food
    // used to render inline here and was a convenient anchor for that; food
    // now has its own route, so the List view's trace of it (FoodSummaryRow,
    // mode === 'edit' only - this file renders no other mode) is what's left
    // to anchor on. Scoped to the row's own labeled section, not a bare link
    // name: ListViewNav's "Food" tab (rendered in every mode) links to the
    // same href and would make an unscoped query ambiguous.
    await screen.findByRole('region', { name: 'Food summary' })
    expect(screen.queryByText("Couldn't load your lists")).toBeNull()
  })

  it('does not clear the cached last-list path on a failed fetch', async () => {
    writeLastListPath(`/lists/${listId}`, OWNER)
    h.fetchLists.mockRejectedValue(new Error('offline'))
    await renderDetail()

    await screen.findByText("Couldn't load your lists")
    expect(readLastListPath(OWNER)).toBe(`/lists/${listId}`)
  })

  it('still shows "List not found", and clears the cache, when the fetch SUCCEEDS without the list', async () => {
    writeLastListPath(`/lists/${listId}`, OWNER)
    h.fetchLists.mockResolvedValue([])
    await renderDetail()

    await screen.findByText('List not found')
    expect(screen.queryByText("Couldn't load your lists")).toBeNull()
    expect(readLastListPath(OWNER)).toBeNull()
  })

  // The case a naive `isError && data === undefined` predicate gets wrong.
  // With a cached collection already in hand, a failed refetch leaves data
  // DEFINED, so that predicate is false and the page falls through to
  // "List not found" - asserting the list is gone on the strength of a
  // request that failed. Both branches are guarded on `!list` instead.
  it('shows the failure state, not "List not found", when the fetch fails over a cached collection that lacks this list', async () => {
    writeLastListPath(`/lists/${listId}`, OWNER)
    // A stale collection from an earlier session, which never contained this
    // list, plus a fetch that fails. data is DEFINED and `list` is undefined:
    // exactly the state an `isError && data === undefined` predicate misses.
    const otherList = { ...list, id: '99999999-8888-4777-8666-555555555555', name: 'Other' } as List
    h.fetchLists.mockRejectedValue(new Error('offline'))
    await renderDetail([otherList])

    await screen.findByText("Couldn't load your lists")
    expect(screen.queryByText('List not found')).toBeNull()
    expect(readLastListPath(OWNER)).toBe(`/lists/${listId}`)
  })

  // The control for the branch above: a resolved list must never be replaced
  // by a status screen just because a background refetch failed.
  it('keeps rendering the open list when a refetch fails but the list is still cached', async () => {
    h.fetchLists.mockResolvedValueOnce([list])
    const qc = await renderDetail()
    await screen.findByRole('region', { name: 'Food summary' })

    h.fetchLists.mockRejectedValue(new Error('offline'))
    await failingRefetch(qc)

    expect(screen.getByRole('region', { name: 'Food summary' })).toBeTruthy()
    expect(screen.queryByText("Couldn't load your lists")).toBeNull()
  })

  // Offline. TanStack parks the fetch at fetchStatus 'paused', which makes
  // isFetching FALSE - so a stale cached collection that never contained this
  // list looks exactly like a settled, successful absence. Without the
  // listsPaused term the page asserts deletion, and the self-heal wipes a
  // perfectly valid last-list pointer, on the strength of a request that has
  // not even been sent.
  it('does not claim "List not found" while a warm-cache refetch is paused offline', async () => {
    writeLastListPath(`/lists/${listId}`, OWNER)
    const otherList = { ...list, id: '99999999-8888-4777-8666-555555555555', name: 'Other' } as List
    h.fetchLists.mockImplementation(() => new Promise(() => {}))
    onlineManager.setOnline(false)

    await renderDetail([otherList])
    await waitFor(() =>
      expect(screen.getByTestId('lists-status').textContent).toBe('success:paused'),
    )

    expect(screen.queryByText('List not found')).toBeNull()
    expect(readLastListPath(OWNER)).toBe(`/lists/${listId}`)
  })
})
