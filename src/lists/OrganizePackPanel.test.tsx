// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { List, ListItemWithGear, PackingLocation } from '../lib/types'

vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  fetchListItems: vi.fn(),
  fetchPackingLocations: vi.fn(),
}))
vi.mock('./ListDocumentToolbar', () => ({ default: () => <div>list toolbar</div> }))
vi.mock('./use-packing-location-actions', () => ({
  usePackingLocationActions: () => ({
    createLocation: { isPending: false, mutate: vi.fn() },
    createItemContainer: { isPending: false, mutate: vi.fn() },
    renameLocation: { mutate: vi.fn() },
    removeLocation: { mutate: vi.fn() },
  }),
}))

import { fetchListItems, fetchPackingLocations } from '../lib/queries'
import OrganizePackPanel from './OrganizePackPanel'

const list: List = {
  id: 'list-1',
  name: 'Trip',
  description: null,
  slug: 'trip',
  foodPlanId: null,
  isShared: false,
  isDraft: false,
  groupWorn: false,
  readyChecksEnabled: false,
  sortOrder: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
}

function item(id: string, name: string, isWorn: boolean): ListItemWithGear {
  return {
    id,
    listId: list.id,
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId: 'loc-1',
    sortOrder: isWorn ? 1 : 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    gearItem: {
      id: `gear-${id}`,
      name,
      description: null,
      weightGrams: 100,
      categoryId: null,
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder: 0,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('OrganizePackPanel worn section', () => {
  it('shows worn items only in a trailing read-only section', async () => {
    const locations: PackingLocation[] = [{
      id: 'loc-1', name: 'Main pack', sortOrder: 0, containerListItemId: null,
    }]
    vi.mocked(fetchPackingLocations).mockResolvedValue(locations)
    vi.mocked(fetchListItems).mockResolvedValue([
      item('tent', 'Tent', false),
      item('jacket', 'Rain jacket', true),
    ])
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={qc}>
        <OrganizePackPanel
          list={list}
          onTogglePackMode={vi.fn()}
          onToggleOrganizeMode={vi.fn()}
        />
      </QueryClientProvider>,
    )

    const worn = await screen.findByRole('region', { name: 'Worn' })
    expect(within(worn).getByText('Rain jacket')).toBeInTheDocument()
    expect(within(worn).queryByRole('button')).not.toBeInTheDocument()

    const mainPack = screen.getByRole('region', { name: 'Main pack' })
    expect(within(mainPack).getByText('Tent')).toBeInTheDocument()
    expect(within(mainPack).queryByText('Rain jacket')).not.toBeInTheDocument()
  })
})
