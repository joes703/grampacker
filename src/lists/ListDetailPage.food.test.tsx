// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import type { Category, GearItem, List, ListItemWithGear, PackingLocation } from '../lib/types'
import type { ListFoodResponse } from '../../shared/food'
import { MobilePrimaryNavProvider } from '../layout/mobile-primary-nav-context'
import { SidebarDrawerProvider } from '../layout/sidebar-drawer-context'

// The first page-level test for ListDetailPage. It exists for invariants that
// unit tests structurally cannot reach: WHERE in the page food is mounted,
// and which of List/Pack/Food's query gates a given failure surfaces behind.
//
// Food has been misplaced three times now. It first shipped gated to
// `mode === 'edit'`, which made it unreachable for anyone working in Pack -
// they concluded the feature did not exist. Removing that gate then exposed a
// second fault that had been hiding in List view: the section sat outside the
// detail loading/error branch, so it rendered its controls over a fabricated
// zero-day snapshot while the real food was still in flight, and a day change
// typed into that snapshot writes against real rows. Food then got its own
// route (/lists/:id/food, see FoodView) - the third fault this file guards
// against is the route sharing ListDetailPage's detail-data gate: a
// gear/categories/items failure has nothing to do with food and must not
// block it, while a food failure must surface FoodView's OWN retry rather
// than the page's generic "Couldn't load list details".
//
// None of these faults are visible from FoodSection's or FoodView's own unit
// tests - each component is correct in isolation. Only mounting the page
// catches where it is wired.

const listId = 'list-1'

const list: List = {
  id: listId,
  name: 'Sierra High Route',
  isShared: false,
  shareSlug: null,
  notes: null,
  readyChecksEnabled: true,
  updatedAt: '2026-07-01T00:00:00.000Z',
} as unknown as List

const food: ListFoodResponse = {
  dayCount: 3,
  slots: [{ id: 'slot-1', dayNumber: 1, meal: 'breakfast', needed: true }],
  items: [],
} as unknown as ListFoodResponse

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
}))

// The page calls authClient.useSession(), which mounts better-auth's nanostores
// session atom. Nanostores keeps an unmounted store alive on a ~1s timer, and
// when that timer fires AFTER vitest has torn down this file's jsdom
// environment, better-auth's cleanupBroadcastSetup touches `window` and throws
// an unhandled ReferenceError - failing CI with every test still passing.
// Mocking the client means the atom never mounts. The session is read here only
// for the last-list pointer's owner id, which no test in this file asserts on.
vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'owner-1' } }, isPending: false }) },
}))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

// jsdom has no matchMedia; the page reads breakpoints to decide which of the
// mobile/desktop surfaces to mount. Answer as a desktop viewport.
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

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <MobilePrimaryNavProvider>
        <SidebarDrawerProvider>{children}</SidebarDrawerProvider>
      </MobilePrimaryNavProvider>
    </QueryClientProvider>
  )
}

async function renderDetail(path: string) {
  // Imported lazily so the module-level query mocks are installed first.
  const { default: ListDetailPage } = await import('./ListDetailPage')
  render(
    <Providers>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/lists/:id" element={<ListDetailPage />} />
          <Route path="/lists/:id/pack" element={<ListDetailPage />} />
          <Route path="/lists/:id/food" element={<ListDetailPage />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  )
}

const foodHeading = () => screen.queryByRole('heading', { name: 'Food' })
// Scoped to FoodSummaryRow's own labeled section, not a bare link name: the
// ListViewNav "Food" tab (part of ListDocumentToolbar, rendered in every
// mode outside the detail-data gate) links to the exact same
// /lists/:id/food href and would otherwise make a name- or href-based query
// ambiguous between the two.
const foodSummarySection = () => screen.queryByRole('region', { name: 'Food summary' })

beforeEach(() => {
  stubViewport(1280)
  h.fetchLists.mockResolvedValue([list] as List[])
  h.fetchListItems.mockResolvedValue([] as ListItemWithGear[])
  h.fetchGearItems.mockResolvedValue([] as GearItem[])
  h.fetchCategories.mockResolvedValue([] as Category[])
  h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
  h.fetchListFood.mockResolvedValue(food)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('food is reachable at its own route, and traced from List view', () => {
  it('renders the food editor at /lists/<id>/food', async () => {
    await renderDetail(`/lists/${listId}/food`)
    expect(await screen.findByRole('heading', { name: 'Food' })).toBeTruthy()
    expect(await screen.findByLabelText('Trip length in days')).toBeTruthy()
  })

  it('shows the food summary row on the list view', async () => {
    await renderDetail(`/lists/${listId}`)
    const section = await screen.findByRole('region', { name: 'Food summary' })
    expect(within(section).getByRole('link')).toHaveAttribute(
      'href',
      `/lists/${listId}/food`,
    )
  })

  it('does not render the food editor inline on the list view', async () => {
    await renderDetail(`/lists/${listId}`)
    // Something the list view always shows once loaded, so the wait settles
    // past the detail-data gate before the negative assertion below.
    await screen.findByRole('region', { name: 'Food summary' })
    expect(screen.queryByLabelText('Trip length in days')).not.toBeInTheDocument()
    expect(foodHeading()).toBeNull()
  })

  // Pack keeps its packing focus. The Food tab in ListViewNav (part of
  // ListDocumentToolbar, rendered in every mode) is Pack's path to food, not
  // an inline section or summary row.
  it('renders neither the food editor nor the summary row in Pack view', async () => {
    await renderDetail(`/lists/${listId}/pack`)
    // ListViewNav (and its "List views" nav landmark) lives in
    // ListDocumentToolbar, ABOVE the mode ternary and outside the
    // detail-data gate - it resolves as soon as the lists query settles, so
    // it would let the negative assertions below pass vacuously, before the
    // loaded branch has even rendered. The packing-location create form is
    // unconditional in Pack mode but sits INSIDE the loaded branch
    // (ListDetailPage.tsx), so waiting on it actually proves the gate opened.
    await screen.findByLabelText('New packing location')
    expect(foodHeading()).toBeNull()
    expect(foodSummarySection()).toBeNull()
  })
})

describe('the Food route owns its own query gates, separate from the detail-data composite', () => {
  // A pending food query must not fall through to the empty-food fallback
  // with live controls: the day input would read 0 for a 3-day trip, and
  // committing that value deletes every slot on the list. FoodView's own
  // pending gate is what prevents that now that food has its own route.
  it('shows FoodView\'s own loading state, not the page\'s generic detail loader', async () => {
    let release: (value: ListFoodResponse) => void = () => {}
    h.fetchListFood.mockReturnValue(
      new Promise<ListFoodResponse>((resolve) => {
        release = resolve
      }),
    )

    await renderDetail(`/lists/${listId}/food`)
    expect(await screen.findByText('Loading food…')).toBeTruthy()
    expect(screen.queryByText('Loading list details...')).toBeNull()
    expect(screen.queryByLabelText('Trip length in days')).not.toBeInTheDocument()

    release(food)
    expect(await screen.findByRole('heading', { name: 'Food' })).toBeTruthy()
  })

  // INVERTED from the pre-Task-5 behavior: a gear/categories/items failure
  // has nothing to do with food, and food is reachable from the same trip
  // whether or not gear ever loaded. Before FoodView had its own route this
  // sibling failure blocked food outright (it shared the composite gate) -
  // that coupling is exactly what this test now forbids.
  it('food editor stays reachable when a sibling detail query fails', async () => {
    h.fetchListItems.mockRejectedValue(new Error('offline'))

    await renderDetail(`/lists/${listId}/food`)
    expect(await screen.findByRole('heading', { name: 'Food' })).toBeTruthy()
    expect(screen.queryByText("Couldn't load list details")).toBeNull()
  })

  // The List view keeps the OLD behavior: the summary row is derived from
  // the same detail-data set the weight totals need, so it still sits behind
  // the composite gate - a sibling failure there is a real reason to
  // withhold a row that claims to summarize food weight.
  it('on the List view, the summary row stays behind the composite detail-data gate', async () => {
    h.fetchListItems.mockRejectedValue(new Error('offline'))

    await renderDetail(`/lists/${listId}`)
    expect(await screen.findByText("Couldn't load list details")).toBeTruthy()
    expect(foodSummarySection()).toBeNull()
  })

  // A food-query failure is now FoodView's own retry state, not the page's
  // generic detail error - the two used to be the same message because food
  // shared the composite gate; now they diverge on purpose so a food-only
  // outage doesn't imply a gear/categories/items outage.
  it('shows FoodView\'s own retry state when the food query itself fails', async () => {
    h.fetchListFood.mockRejectedValue(new Error('offline'))

    await renderDetail(`/lists/${listId}/food`)
    expect(await screen.findByText("Couldn't load the food plan.")).toBeTruthy()
    expect(screen.queryByText("Couldn't load list details")).toBeNull()
    expect(screen.queryByLabelText('Trip length in days')).not.toBeInTheDocument()
  })
})
