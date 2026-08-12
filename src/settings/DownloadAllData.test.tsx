// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Category, GearItem, List, ListItemWithGear, PackingLocation } from '../lib/types'

// Mock fflate's dynamic import: strToU8 stays functional (encodes to
// bytes), zipSync is a stub returning fixed bytes. The REAL
// buildTakeoutFiles runs, so this exercises the actual file-map keys.
// Typed param (and used, so lint is happy) gives zipSync.mock.calls its
// real shape; the returned bytes are irrelevant to the assertions.
const zipSync = vi.fn(
  (files: Record<string, Uint8Array>) => new Uint8Array(Object.keys(files).length),
)
const strToU8 = vi.fn((s: string) => new TextEncoder().encode(s))
vi.mock('fflate', () => ({ zipSync, strToU8 }))

// Mock only the network fetchers; queryKeys stays real.
vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  fetchCategories: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
}))

import {
  fetchCategories,
  fetchGearItems,
  fetchLists,
  fetchListItems,
  fetchPackingLocations,
  fetchListFood,
} from '../lib/queries'
import DownloadAllData from './DownloadAllData'

const categories: Category[] = [
  { id: 'cat-shelter', name: 'Shelter', sortOrder: 0, createdAt: '2024-01-01' },
]
const gearItems: GearItem[] = [
  {
    id: 'g-1', categoryId: 'cat-shelter', name: 'Tarp', description: null,
    weightGrams: 240, cost: null, purchaseDate: null, status: 'active',
    sortOrder: 0, createdAt: '2024-01-01', updatedAt: '2024-01-01',
  },
]
const lists: List[] = [
  {
    id: 'l-1', name: 'Weekend Trip', description: null, slug: 's1', isShared: false,
    isDraft: false, sortOrder: 0,
    createdAt: '2024-01-01', updatedAt: '2024-01-01',
  },
  {
    id: 'l-2', name: 'Thru Hike', description: null, slug: 's2', isShared: false,
    isDraft: false, sortOrder: 1,
    createdAt: '2024-01-01', updatedAt: '2024-01-01',
  },
]
function itemFor(listId: string, id: string): ListItemWithGear {
  return {
    id, listId, gearItemId: 'g-1', quantity: 1, isWorn: false, isConsumable: false,
    isPacked: false, isReady: false, packingLocationId: null, sortOrder: 0,
    packSortOrder: 0,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01', gearItem: gearItems[0]!,
  }
}

const packingLocations: PackingLocation[] = [
  { id: 'loc-1', name: 'Main pack', sortOrder: 0, containerListItemId: null },
]

let clickedDownloadName: string | null = null

beforeEach(() => {
  clickedDownloadName = null
  vi.mocked(fetchCategories).mockResolvedValue(categories)
  vi.mocked(fetchGearItems).mockResolvedValue(gearItems)
  vi.mocked(fetchLists).mockResolvedValue(lists)
  vi.mocked(fetchListItems).mockImplementation((listId: string) =>
    Promise.resolve([itemFor(listId, `i-${listId}`)]),
  )
  vi.mocked(fetchPackingLocations).mockResolvedValue(packingLocations)
  vi.mocked(fetchListFood).mockResolvedValue({ dayCount: 0, slots: [], items: [] })
  // jsdom implements neither of these object-URL helpers.
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clickedDownloadName = this.download
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <DownloadAllData />
    </QueryClientProvider>,
  )
}

describe('DownloadAllData', () => {
  it('zips gear + one CSV per list and triggers a timestamped download', async () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: /download \.zip/i }))

    await waitFor(() => expect(zipSync).toHaveBeenCalledTimes(1))

    // The file map handed to fflate carries the gear library, the packing
    // snapshot, and one entry per list, keyed by slugified name.
    const files = zipSync.mock.calls[0]![0]
    expect(Object.keys(files).sort()).toEqual([
      'food.json',
      'gear-library.csv',
      'lists/thru-hike.csv',
      'lists/weekend-trip.csv',
      'packing.json',
    ])

    // Items were fetched once per list (no bulk endpoint).
    expect(fetchListItems).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetchListItems).mock.calls.map(([id]) => id).sort()).toEqual([
      'l-1',
      'l-2',
    ])
    expect(fetchPackingLocations).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetchPackingLocations).mock.calls.map(([id]) => id).sort()).toEqual([
      'l-1',
      'l-2',
    ])
    // A download fired with the export filename.
    expect(clickedDownloadName).toMatch(/^grampacker-export-.*\.zip$/)
  })

  it('surfaces a failed fetch as an inline error and never zips', async () => {
    vi.mocked(fetchGearItems).mockRejectedValue(new Error('network down'))
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: /download \.zip/i }))

    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument())
    expect(zipSync).not.toHaveBeenCalled()
  })
})
