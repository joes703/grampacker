// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import type { Category, GearItem, List, ListItemWithGear, PackingLocation } from '../lib/types'
import type { FoodItemResponse, ListFoodResponse } from '../../shared/food'
import { MobilePrimaryNavProvider } from '../layout/mobile-primary-nav-context'
import { SidebarDrawerProvider } from '../layout/sidebar-drawer-context'

// Food as a full peer of gear in Pack mode (0022). What these tests pin:
// food rows render as checkable pack rows, the checkbox PATCHes the food
// item, the progress header counts the union, and none of it leaks into the
// List (edit) view - food's editing surface stays the Food view.

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
  isPacked: true,
  isReady: false,
  packingLocationId: null,
  sortOrder: 0,
  packSortOrder: 0,
} as unknown as ListItemWithGear

const tortillas: FoodItemResponse = {
  id: 'food-1',
  name: 'Tortillas',
  weightGrams: 300,
  quantity: 2,
  sortOrder: 0,
  isPacked: false,
  isReady: false,
  packingLocationId: null,
  packSortOrder: 0,
  slotIds: [],
}

const foodWithTortillas: ListFoodResponse = {
  dayCount: 2,
  slots: [],
  items: [tortillas],
}

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
  updateFoodItem: vi.fn(),
}))

vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'owner-1' } }, isPending: false }) },
}))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

// The page imports the food PATCH from its own module rather than the
// queries barrel, so it needs its own mock edge.
vi.mock('../lib/queries/food', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries/food')>()
  return { ...actual, updateFoodItem: h.updateFoodItem }
})

function stubViewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const m = /width\s*<\s*([\d.]+)px/.exec(query)
    return {
      matches: m ? width < Number(m[1]) : false,
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
  // Same anchors as ListDetailPage.pack.test.tsx: strictly inside the loaded
  // branch of each mode.
  if (path.endsWith('/pack')) {
    await screen.findByLabelText('New packing location')
  } else {
    await screen.findByRole('region', { name: 'Food summary' })
  }
}

beforeEach(() => {
  stubViewport(1280)
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([listItem])
  h.fetchGearItems.mockResolvedValue([gear])
  h.fetchCategories.mockResolvedValue([] as Category[])
  h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
  h.fetchListFood.mockResolvedValue(foodWithTortillas)
  h.updateFoodItem.mockResolvedValue({ ...tortillas, isPacked: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('food rows in Pack mode', () => {
  it('renders the food row in the fallback Food section with a packed checkbox', async () => {
    await renderDetail(`/lists/${listId}/pack`)

    const row = (await screen.findByText('Tortillas')).closest('div[class*="flex"]')
    expect(row).not.toBeNull()
    // The wrapping label makes the food name the checkbox's accessible name.
    expect(screen.getByRole('checkbox', { name: 'Tortillas' })).not.toBeChecked()
    // Ready checkbox parity with gear rows.
    expect(screen.getByRole('checkbox', { name: 'Mark Tortillas ready' })).not.toBeChecked()
  })

  it('ticking the checkbox PATCHes the food item packed', async () => {
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(await screen.findByRole('checkbox', { name: 'Tortillas' }))
    await waitFor(() => expect(h.updateFoodItem).toHaveBeenCalledWith(
      listId,
      'food-1',
      { isPacked: true },
    ))
  })

  // A bag is one cohort of gear and food rows. A weight cell on one and not
  // the other pushes every column to its right out of alignment in a mixed
  // section, so the two rows carry the identical cell.
  it('gives food rows the same weight cell as the gear rows beside them', async () => {
    await renderDetail(`/lists/${listId}/pack`)

    // The gear weight appears twice now - once in the pack row, once in the
    // picker aside, which renders in Pack since the one-page change. Pick the
    // row cell by the column width only the row uses.
    const rowCell = (label: string) =>
      screen
        .getAllByLabelText(label)
        .map((el) => el.parentElement)
        .find((el) => el?.className.includes('w-24'))

    await screen.findByLabelText('300 g')
    const foodWeight = rowCell('300 g')
    const gearWeight = rowCell('210 g')

    expect(foodWeight).toBeDefined()
    expect(foodWeight?.className).toBe(gearWeight?.className)
  })

  // Gear rows reach the gear editor from this menu. Food does not: food is
  // authored in the Food view, which is the same reason food rows carry no
  // "Remove from list" either.
  it('offers no Edit item on a food row', async () => {
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(
      await screen.findByRole('button', { name: 'Open Tortillas packing options' }),
    )

    expect(screen.queryByRole('button', { name: 'Edit item' })).toBeNull()
  })

  it('counts food in the packing progress header', async () => {
    await renderDetail(`/lists/${listId}/pack`)

    // One packed gear item + one unpacked food item = 1 / 2.
    expect(screen.getByText('1 / 2 packed')).toBeInTheDocument()
  })

  it('does not render food rows in the List (edit) view', async () => {
    await renderDetail(`/lists/${listId}`)

    // The summary row region exists; the food ITEM row does not.
    const summary = screen.getByRole('region', { name: 'Food summary' })
    expect(within(summary).queryByText('Tortillas')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Tortillas' })).not.toBeInTheDocument()
  })
})
