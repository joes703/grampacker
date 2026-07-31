// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import type { Category, GearItem, List, ListItemWithGear, PackingLocation } from '../lib/types'
import type { ListFoodResponse } from '../../shared/food'
import { MobilePrimaryNavProvider } from '../layout/mobile-primary-nav-context'
import { SidebarDrawerProvider } from '../layout/sidebar-drawer-context'

// Pack's entry point back to the gear library.
//
// Desktop Pack hides the left aside on purpose so packing gets the focus.
// That also removed the only desktop way to put a forgotten item on the list
// without leaving the view - Pack could rearrange what was already there and
// nothing else. The drawer restores adding without giving the aside back.
//
// Which surface carries the trigger is the whole point of these tests, so
// they assert per-breakpoint and per-view rather than just "a button exists".

const listId = 'list-1'

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

const wornItem = {
  ...listItem,
  id: 'li-worn',
  gearItemId: 'gear-worn',
  gearItem: { ...gear, id: 'gear-worn', name: 'Sun hoody' },
  isWorn: true,
  sortOrder: 1,
} as unknown as ListItemWithGear

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
  deleteListItem: vi.fn(),
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
  // Anchors on content that only exists past the detail loading gate.
  await screen.findByRole('heading', { name: 'Food' })
}

const addGear = () => screen.queryByRole('button', { name: 'Add gear' })

beforeEach(() => {
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([listItem])
  h.fetchGearItems.mockResolvedValue([gear])
  h.fetchCategories.mockResolvedValue([] as Category[])
  h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
  h.fetchListFood.mockResolvedValue(emptyFood)
  h.deleteListItem.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('adding gear from Pack view', () => {
  it('offers Add gear on desktop Pack, where the library aside is hidden', async () => {
    stubViewport(1280)
    await renderDetail(`/lists/${listId}/pack`)
    expect(addGear()).toBeTruthy()
  })

  it('opens the gear library from that button', async () => {
    stubViewport(1280)
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(addGear() as HTMLElement)

    // The drawer is lazy-loaded, so this also proves the chunk resolves.
    expect(await screen.findByText('Add from gear')).toBeTruthy()
  })

  // The bottom action bar already carries Add below lg. A second button would
  // be two controls for one action on the surface with the least room.
  it('omits the button below lg, where the action bar already has Add', async () => {
    stubViewport(500)
    await renderDetail(`/lists/${listId}/pack`)
    expect(addGear()).toBeNull()
  })

  // List view keeps the aside, so the library is already on screen.
  it('omits the button in desktop List view, which shows the aside', async () => {
    stubViewport(1280)
    await renderDetail(`/lists/${listId}`)
    expect(addGear()).toBeNull()
  })
})

// Every list starts with no packing locations, so Pack falls back to category
// grouping - which is the state a new user meets this view in. Removal has to
// be there, not only once a bag exists.
describe('removing gear from Pack view', () => {
  it('offers removal on a pack row when the list has no locations yet', async () => {
    stubViewport(1280)
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(
      screen.getByRole('button', { name: 'Open Cooking pot packing options' }),
    )
    await user.click(screen.getByRole('button', { name: 'Remove from list' }))

    expect(h.deleteListItem).toHaveBeenCalledWith(listId, 'li-1')
  })

  // Worn rows sit outside the packing tree, so they never receive the packing
  // kebab. Without their own affordance the Worn section is the one place in
  // Pack you cannot drop an item from.
  it('offers removal on a worn row, which has no packing kebab', async () => {
    stubViewport(1280)
    h.fetchListItems.mockResolvedValue([listItem, wornItem])
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(
      screen.getByRole('button', { name: 'Remove Sun hoody from list' }),
    )

    expect(h.deleteListItem).toHaveBeenCalledWith(listId, 'li-worn')
  })

  // The category-grouped sections are shared with List view, so the binding
  // that adds the packing kebab is mode-gated.
  //
  // Scope, stated because it is narrower than the title suggests: ItemRow
  // renders rowAction only inside its pack branch, so List view would look
  // like this even if the gate were removed. What this pins is the
  // USER-VISIBLE contract - List rows keep exactly one kebab, and the worn
  // removal button is a pack affordance. The gate itself earns its keep
  // elsewhere (it keeps List view from building menus and placement bindings
  // it will not render), and that is not observable from the DOM.
  it('shows no packing affordances on List view rows', async () => {
    stubViewport(1280)
    h.fetchListItems.mockResolvedValue([listItem, wornItem])
    await renderDetail(`/lists/${listId}`)

    expect(
      screen.queryByRole('button', { name: 'Open Cooking pot packing options' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Remove Sun hoody from list' }),
    ).toBeNull()
  })
})
