// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import type { List } from '../lib/types'
import { MobilePrimaryNavProvider } from '../layout/mobile-primary-nav-context'

// jsdom has no matchMedia; ListsPage reads useIsMobile() (max-width: 767px)
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
    const m = /max-width:\s*(\d+)px/.exec(query)
    const matches = m ? width <= Number(m[1]) : false
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

afterEach(cleanup)

function list(over: Partial<List> = {}): List {
  return {
    id: 'list-1',
    name: 'Weekend trip',
    description: null,
    slug: 'weekend-trip',
    foodPlanId: null,
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

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/lists']}>
        <MobilePrimaryNavProvider>{children}</MobilePrimaryNavProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(<ListsPage />, { wrapper })
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
