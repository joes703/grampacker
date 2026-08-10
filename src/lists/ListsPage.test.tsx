// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import type { List } from '../lib/types'
import { queryKeys, fetchLists } from '../lib/queries'
import { MobilePrimaryNavProvider } from '../layout/mobile-primary-nav-context'

// jsdom has no matchMedia; ListsPage reads useIsMobile() (width < 768px)
// to pick where the "New list" create input renders. stubViewport(width)
// answers the media queries from a pretend viewport width so we can drive the
// mobile (<768px) and desktop (>=1024px) paths.
//
// NOTE: jsdom applies no CSS, so this can't assert real display:none
// visibility. What it DOES guard is the JS gating that is the fix's
// mechanism: below md the input renders in a phone-only surface (isMobile),
// and the header copy is suppressed (!isMobile), so exactly one create input
// exists at any width. Before the fix, on phones the input lived only in the
// hidden desktop header and never rendered on this path at all.
function stubViewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const m = /width\s*<\s*([\d.]+)rem/.exec(query)
    // Queries are rem (Tailwind's own unit); *16 converts to the px widths
    // these tests pass. Strict, matching use-breakpoint.ts: at exactly
    // 48rem the query is false and Tailwind's `md:` takes over.
    const matches = m ? width < Number(m[1]) * 16 : false
    return {
      matches,
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
beforeEach(() => stubViewport(1280))

const h = vi.hoisted(() => ({
  fetchLists: vi.fn<() => Promise<List[]>>(),
}))
vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, fetchLists: h.fetchLists }
})
// The create flow's mutations/navigation aren't under test here — only where
// its input renders. Keep them inert so no real mutation or navigate fires.
vi.mock('./use-current-list-actions', () => ({
  useCurrentListActions: () => ({
    createListMut: { mutate: vi.fn(), isPending: false },
    submitCreateList: vi.fn(),
    renameMut: { mutate: vi.fn(), isPending: false },
    duplicateMut: { mutate: vi.fn(), isPending: false },
    deleteListMut: { mutate: vi.fn(), isPending: false },
    exportCsv: vi.fn(),
    exportingListId: null,
  }),
}))

import ListsPage from './ListsPage'

afterEach(() => {
  cleanup()
  // onlineManager is module-global; the offline test would otherwise pause
  // every later query in this file.
  onlineManager.setOnline(true)
})

function list(over: Partial<List> = {}): List {
  return {
    id: 'list-1',
    name: 'Weekend trip',
    description: null,
    slug: 'weekend-trip',
    isShared: false,
    sortOrder: 0,
    groupWorn: false,
    readyChecksEnabled: false,
    isDraft: false,
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
    ...over,
  }
}

// An independent observer on the same query key. Tests wait until THIS has
// rendered the status they are looking for, which is the same barrier the page
// must cross, with no dependence on the notification scheduler's tick count.
// It renders status AND fetchStatus because status alone cannot express the
// case these tests exist for: 'pending' covers both an in-flight cold load and
// one parked offline, and it is specifically the parked one that used to render
// the empty state. Waiting on the pair asserts the state by name.
function ListsQueryProbe() {
  const { status, fetchStatus } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: fetchLists,
  })
  return <span data-testid="lists-status">{`${status}:${fetchStatus}`}</span>
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/lists']}>
        <MobilePrimaryNavProvider>
          <ListsQueryProbe />
          {children}
        </MobilePrimaryNavProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  // qc is returned so a test can drive a BACKGROUND refetch, which is the
  // only way to reach the "errored but still holding data" state.
  return { qc, ...render(<ListsPage />, { wrapper }) }
}

// Click the bottom bar's Add slot (aria-label "New list"), disambiguated from
// the desktop header button by scoping to the mobile bar's nav landmark.
function tapBottomBarAdd() {
  const bar = screen.getByRole('navigation', {
    name: 'Lists navigation and actions',
  })
  fireEvent.click(within(bar).getByRole('button', { name: 'New list' }))
}

// The desktop header block is the div directly wrapping the "Lists" heading.
// Its inline create input is gated on !isMobile, so on phones the input must
// NOT live here (it renders in the sibling phone surface instead). jsdom
// applies no CSS, so checking the input's CONTAINER — not its visibility — is
// what distinguishes the fix from the reverted bug, where the input rendered
// only inside this (CSS-hidden) header and so never appeared on phones.
function desktopHeader(): HTMLElement {
  const heading = screen.getByRole('heading', { name: /Lists/ })
  const parent = heading.parentElement
  if (!parent) throw new Error('Lists heading has no parent header block')
  return parent
}

// Wait for the mocked lists query to settle (the row renders) before
// interacting, so no late React Query update lands after the assertions.
async function renderSettledPage() {
  renderPage()
  await screen.findByText('Weekend trip')
}

describe('ListsPage create-input placement', () => {
  it.each([390, 1024])('renders one visible route heading at %i px', async (width) => {
    stubViewport(width)
    h.fetchLists.mockResolvedValue([list()])
    await renderSettledPage()

    expect(screen.getAllByRole('heading', { level: 1, name: /Lists/ })).toHaveLength(1)
  })

  it('renders the create input in the phone surface, not the desktop header, on a phone (regression: phone create was impossible)', async () => {
    stubViewport(375)
    h.fetchLists.mockResolvedValue([list()])
    await renderSettledPage()

    expect(screen.queryByPlaceholderText('List name')).toBeNull()

    // On a phone the only trigger is the bottom bar.
    tapBottomBarAdd()

    // Exactly one input total (getBy throws on 0 or >1)...
    expect(screen.getByPlaceholderText('List name')).toBeTruthy()
    // ...and it is NOT the desktop-header copy. Before the fix the only input
    // lived inside this header, so on a phone the create form never rendered
    // on this path — this assertion fails against that reverted state.
    expect(within(desktopHeader()).queryByPlaceholderText('List name')).toBeNull()
  })

  it('routes the bottom-bar create into the header input on a tablet (768-1023px)', async () => {
    stubViewport(900)
    h.fetchLists.mockResolvedValue([list()])
    await renderSettledPage()

    expect(screen.queryByPlaceholderText('List name')).toBeNull()

    // Tablet still shows the bottom bar (lg:hidden), but isMobile is false, so
    // the input belongs in the header — and there must be exactly one.
    tapBottomBarAdd()

    expect(screen.getByPlaceholderText('List name')).toBeTruthy()
    expect(within(desktopHeader()).getByPlaceholderText('List name')).toBeTruthy()
  })

  it('opens the header create input from the desktop header button (no phone duplicate)', async () => {
    stubViewport(1280)
    h.fetchLists.mockResolvedValue([list()])
    await renderSettledPage()

    expect(screen.queryByPlaceholderText('List name')).toBeNull()

    // Exercise the real desktop production path: the header "New list" button.
    fireEvent.click(within(desktopHeader()).getByRole('button', { name: 'New list' }))

    // Still exactly one input, and the header owns it (phone surface gated out).
    expect(screen.getByPlaceholderText('List name')).toBeTruthy()
    expect(within(desktopHeader()).getByPlaceholderText('List name')).toBeTruthy()
  })
})

// A failed lists fetch used to be indistinguishable from having no lists:
// useReorderable defaults `items` to [], so the page fell into the
// brand-new-user onboarding state. That copy tells an existing user their
// lists are gone, and offers no way to retry.
describe('ListsPage lists-fetch failure', () => {
  it('renders a retryable failure state, not the empty state', async () => {
    h.fetchLists.mockRejectedValue(new Error('offline'))
    renderPage()

    await screen.findByText("Couldn't load your lists")
    expect(screen.queryByText('Create your first list')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('refetches when Retry is clicked', async () => {
    h.fetchLists.mockRejectedValueOnce(new Error('offline'))
    renderPage()

    await screen.findByText("Couldn't load your lists")
    h.fetchLists.mockResolvedValue([list()])
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByText('Weekend trip')
    expect(screen.queryByText("Couldn't load your lists")).toBeNull()
  })

  it('still shows the empty state when the fetch SUCCEEDS with no lists', async () => {
    h.fetchLists.mockResolvedValue([])
    renderPage()

    await screen.findByText('Create your first list')
    expect(screen.queryByText("Couldn't load your lists")).toBeNull()
  })

  // The trap inside the fix. TanStack Query v5 sets status to 'error' on a
  // failed BACKGROUND refetch while KEEPING the cached rows, so isError is
  // true with a fully rendered page on screen. Keying the failure panel on
  // bare isError would blank the page after any post-mutation blip, and every
  // list mutation invalidates ['lists']. isLoadingError is what excludes it.
  it('keeps rendering cached lists when a LATER refetch fails', async () => {
    h.fetchLists.mockResolvedValueOnce([list()])
    const { qc } = renderPage()
    await screen.findByText('Weekend trip')

    h.fetchLists.mockRejectedValue(new Error('offline'))
    void qc.refetchQueries({ queryKey: queryKeys.lists() })
    // Wait on a RENDERED observer, not on qc.getQueryState. The cache flips to
    // 'error' before any React observer re-renders, so asserting off cache
    // state inspects the pre-error DOM and this test would pass against the
    // bare-isError bug it exists to catch.
    await waitFor(() =>
      expect(screen.getByTestId('lists-status').textContent).toBe('error:idle'),
    )

    expect(screen.getByText('Weekend trip')).toBeTruthy()
    expect(screen.queryByText("Couldn't load your lists")).toBeNull()
  })

  // Cold load with the browser offline. TanStack parks the fetch at
  // fetchStatus 'paused', and v5's isLoading is `isPending && isFetching` - so
  // isLoading is FALSE with zero rows in hand. Gated on isLoading, this page
  // pitched the brand-new-user onboarding state at an offline user who has
  // lists.
  it('does not show the empty state on a cold load that is paused offline', async () => {
    h.fetchLists.mockImplementation(() => new Promise(() => {}))
    onlineManager.setOnline(false)
    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('lists-status').textContent).toBe('pending:paused'),
    )
    expect(screen.queryByText('Create your first list')).toBeNull()
  })
})
