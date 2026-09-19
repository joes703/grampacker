// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import type { Category, GearItem, List, ListItemWithGear, PackingLocation } from '../lib/types'
import type { ListFoodResponse } from '../../shared/food'
import { MobilePrimaryNavProvider } from '../layout/mobile-primary-nav-context'
import { SidebarDrawerProvider } from '../layout/sidebar-drawer-context'

// Printing a pack list.
//
// The assertion that earns this file is the FILTER one. Pack's row filters
// drop items from the rendered array rather than hiding them with CSS, so a
// sheet printed with a filter on is silently short of gear - and because the
// filter switches themselves do not print, the paper carries no clue that
// anything is missing. No print stylesheet can fix that; it has to be fixed
// in what gets rendered, which means it has to be tested here rather than
// asserted as a class name.
//
// The class-name assertions below are deliberately thin. They pin the few
// places where print behavior is decided in a component rather than in the
// shared tokens, so a later edit cannot quietly drop them. What none of this
// can prove is that the sheet LOOKS right - jsdom paginates nothing. That
// check is a human in a print preview.

const listId = 'list-1'

const list = {
  id: listId,
  name: 'Sierra High Route',
  isShared: false,
  shareSlug: null,
  description: null,
  updatedAt: '2026-07-01T00:00:00.000Z',
} as unknown as List

const gear = {
  id: 'gear-1',
  name: 'Cooking pot',
  weightGrams: 210,
  categoryId: null,
} as unknown as GearItem

const unpackedItem = {
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

// The row a filtered print would lose.
const packedItem = {
  ...unpackedItem,
  id: 'li-2',
  gearItemId: 'gear-2',
  gearItem: { ...gear, id: 'gear-2', name: 'Titanium spork' },
  isPacked: true,
  sortOrder: 1,
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

// Same reason as ListDetailPage.pack.test.tsx: keep better-auth's nanostores
// session atom from outliving this file's jsdom environment.
vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'owner-1' } }, isPending: false }) },
}))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

function stubViewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const m = /width\s*<\s*([\d.]+)rem/.exec(query)
    return {
      matches: m ? width < Number(m[1]) * 16 : false,
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

async function renderPack() {
  const { default: ListDetailPage } = await import('./ListDetailPage')
  render(
    <Providers>
      <MemoryRouter initialEntries={[`/lists/${listId}/pack`]}>
        <Routes>
          <Route path="/lists/:id/pack" element={<ListDetailPage />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  )
  await screen.findByLabelText('New packing location')
}

// What the browser does immediately before it snapshots the page. The hook
// under test listens for exactly this.
function firePrint() {
  act(() => {
    window.dispatchEvent(new Event('beforeprint'))
  })
}

function fireAfterPrint() {
  act(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
}

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.open = false }
  }
})

beforeEach(() => {
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([unpackedItem, packedItem])
  h.fetchGearItems.mockResolvedValue([gear])
  h.fetchCategories.mockResolvedValue([] as Category[])
  h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
  h.fetchListFood.mockResolvedValue(emptyFood)
  stubViewport(1400)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('printing renders the full list regardless of the pack filters', () => {
  it('restores rows a filter removed, for the duration of the print', async () => {
    const user = userEvent.setup()
    await renderPack()

    // Baseline: both rows on screen.
    expect(screen.queryByText('Titanium spork')).toBeTruthy()

    await user.click(screen.getByLabelText('Show unpacked only'))
    // The packed row is GONE from the DOM, not merely hidden - which is the
    // whole reason print CSS cannot rescue it.
    expect(screen.queryByText('Titanium spork')).toBeNull()

    firePrint()
    expect(screen.queryByText('Titanium spork')).toBeTruthy()
  })

  it('puts the filter back after printing, so the screen is unchanged', async () => {
    const user = userEvent.setup()
    await renderPack()

    await user.click(screen.getByLabelText('Show unpacked only'))
    firePrint()
    fireAfterPrint()

    expect(screen.queryByText('Titanium spork')).toBeNull()
    // The switch still reads as on: printing overrides what is RENDERED, it
    // does not silently reset the user's setting.
    expect(screen.getByLabelText('Show unpacked only')).toBeChecked()
  })

  it('does the same for the ready filter', async () => {
    const user = userEvent.setup()
    h.fetchListItems.mockResolvedValue([
      unpackedItem,
      { ...packedItem, isPacked: false, isReady: true } as unknown as ListItemWithGear,
    ])
    await renderPack()

    await user.click(screen.getByLabelText('Show un-ready only'))
    expect(screen.queryByText('Titanium spork')).toBeNull()

    firePrint()
    expect(screen.queryByText('Titanium spork')).toBeTruthy()
  })
})

describe('the printed sheet identifies itself', () => {
  it('carries the list name, which no screen chrome provides on paper', async () => {
    await renderPack()

    // Scoped to the print header by testid on purpose: the screen toolbar
    // renders the list name in an h1 too, and that one is print:hidden. A
    // page-wide query would match it and pass even if this header vanished.
    const header = screen.getByTestId('print-list-header')
    expect(header.className).toContain('print:block')
    expect(header.textContent).toContain('Sierra High Route')
  })

  it('names the two checkbox columns, which print as identical blank squares', async () => {
    await renderPack()
    expect(screen.getByText(/Ready · Packed/)).toBeTruthy()
  })

  it('counts gear and food as one union, matching the progress metric', async () => {
    await renderPack()
    expect(screen.getByText(/^2 items/)).toBeTruthy()
  })
})

describe('print affordance', () => {
  it('offers Print in pack mode', async () => {
    await renderPack()
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy()
  })
})
