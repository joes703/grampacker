// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollisionDetection } from '@dnd-kit/core'
import { closestCenter } from '@dnd-kit/core'
import { makeDnDId } from '../lib/dnd-ids'
import type { List, ListItemWithGear, PackingLocation } from '../lib/types'

const dndMocks = vi.hoisted(() => ({
  collisionDetection: undefined as CollisionDetection | undefined,
  closestCenter: vi.fn(() => []),
}))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const React = await import('react')
  return {
    ...actual,
    closestCenter: dndMocks.closestCenter,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      dndMocks.collisionDetection = props.collisionDetection
      return React.createElement(actual.DndContext, props)
    },
  }
})

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

function item(
  id: string,
  name: string,
  isWorn: boolean,
  packingLocationId = 'loc-1',
): ListItemWithGear {
  return {
    id,
    listId: list.id,
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId,
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
  dndMocks.collisionDetection = undefined
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

describe('OrganizePackPanel location collision wiring', () => {
  it('offers only sibling locations while reordering a location', async () => {
    const locations: PackingLocation[] = [
      { id: 'loc-a', name: 'A', sortOrder: 0, containerListItemId: null },
      { id: 'loc-b', name: 'B', sortOrder: 1, containerListItemId: 'item-b' },
      { id: 'loc-z', name: 'Z', sortOrder: 2, containerListItemId: null },
    ]
    vi.mocked(fetchPackingLocations).mockResolvedValue(locations)
    vi.mocked(fetchListItems).mockResolvedValue([
      item('item-b', 'B', false, 'loc-z'),
    ])
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={qc}>
        <OrganizePackPanel
          list={list}
        />
      </QueryClientProvider>,
    )

    await screen.findByRole('region', { name: 'A' })
    expect(dndMocks.collisionDetection).toBeDefined()

    const containers = [
      { id: makeDnDId('packing-location', 'loc-a') },
      { id: makeDnDId('packing-location', 'loc-b') },
      { id: makeDnDId('packing-location', 'loc-z') },
    ]
    dndMocks.collisionDetection?.({
      active: { id: makeDnDId('packing-location', 'loc-a') },
      droppableContainers: containers,
    } as unknown as Parameters<CollisionDetection>[0])

    const collisionArgs = vi.mocked(closestCenter).mock.calls.at(-1)?.[0]
    expect(collisionArgs?.droppableContainers.map((container) => container.id)).toEqual([
      makeDnDId('packing-location', 'loc-a'),
      makeDnDId('packing-location', 'loc-z'),
    ])
  })
})
