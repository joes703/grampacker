// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import type { Category, GearItem, List, ListItemWithGear, PackingLocation } from '../lib/types'
import type { ListFoodResponse } from '../../shared/food'
import { MobilePrimaryNavProvider } from '../layout/mobile-primary-nav-context'
import { SidebarDrawerProvider } from '../layout/sidebar-drawer-context'

// The first page-level test for ListDetailPage. It exists for one invariant
// that unit tests structurally cannot reach: WHERE in the page the food
// section is mounted.
//
// Food has been misplaced twice. It first shipped gated to `mode === 'edit'`,
// which made it unreachable for anyone working in Pack - they concluded the
// feature did not exist. Removing that gate then exposed a second fault that
// had been hiding in List view: the section sat outside the detail
// loading/error branch, so it rendered its controls over a fabricated
// zero-day snapshot while the real food was still in flight, and a day change
// typed into that snapshot writes against real rows.
//
// Neither fault is visible from FoodSection's own tests - the component is
// correct in both. Only mounting the page catches them.

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
        </Routes>
      </MemoryRouter>
    </Providers>,
  )
}

const foodHeading = () => screen.queryByRole('heading', { name: 'Food' })

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

describe('food is reachable from both list views', () => {
  it('renders the food section in List view', async () => {
    await renderDetail(`/lists/${listId}`)
    expect(await screen.findByRole('heading', { name: 'Food' })).toBeTruthy()
  })

  // The regression this file was created for. Pack is where the list is
  // actually used, and food was invisible there.
  it('renders the food section in Pack view', async () => {
    await renderDetail(`/lists/${listId}/pack`)
    expect(await screen.findByRole('heading', { name: 'Food' })).toBeTruthy()
  })

  it('offers the trip-length control in Pack view, not just a read-only echo', async () => {
    await renderDetail(`/lists/${listId}/pack`)
    const days = await screen.findByLabelText('Trip length in days')
    expect((days as HTMLInputElement).disabled).toBe(false)
    expect((days as HTMLInputElement).value).toBe('3')
  })
})

describe('food never renders over unresolved detail data', () => {
  // A pending food query must not fall through to the empty-food fallback
  // with live controls: the day input would read 0 for a 3-day trip, and
  // committing that value deletes every slot on the list.
  it('is absent while detail data is still loading', async () => {
    let release: (value: ListFoodResponse) => void = () => {}
    h.fetchListFood.mockReturnValue(
      new Promise<ListFoodResponse>((resolve) => {
        release = resolve
      }),
    )

    await renderDetail(`/lists/${listId}/pack`)
    expect(await screen.findByText('Loading list details...')).toBeTruthy()
    expect(foodHeading()).toBeNull()

    release(food)
    expect(await screen.findByRole('heading', { name: 'Food' })).toBeTruthy()
  })

  it('is absent when a sibling detail query fails', async () => {
    h.fetchListItems.mockRejectedValue(new Error('offline'))

    await renderDetail(`/lists/${listId}/pack`)
    expect(await screen.findByText("Couldn't load list details")).toBeTruthy()
    expect(foodHeading()).toBeNull()
  })

  it('is absent when the food query itself fails', async () => {
    h.fetchListFood.mockRejectedValue(new Error('offline'))

    await renderDetail(`/lists/${listId}/pack`)
    expect(await screen.findByText("Couldn't load list details")).toBeTruthy()
    expect(foodHeading()).toBeNull()
  })
})
