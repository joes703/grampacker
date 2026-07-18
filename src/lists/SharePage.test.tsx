// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { SharedListResponse } from '../lib/types'

// Mock only the fetcher SharePage calls; keep the real queryKeys and
// everything else in the barrel (grouping/breakdown/etc. are separate
// modules and stay real, so this test exercises the actual narrow->wide
// mapping, grouping and weight math).
vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  fetchSharedList: vi.fn(),
}))

import { fetchSharedList } from '../lib/queries'
import SharePage from './SharePage'

// jsdom has no matchMedia; SharePage -> useIsBelowLg() reads it during render.
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

function share(over: {
  list?: Partial<SharedListResponse['list']>
  categories?: SharedListResponse['categories']
  items?: SharedListResponse['items']
  food?: SharedListResponse['food']
} = {}): SharedListResponse {
  return {
    list: {
      name: 'Trip',
      description: null,
      groupWorn: false,
      isDraft: false,
      ...over.list,
    },
    categories: over.categories ?? [],
    items: over.items ?? [],
    // No plan attached is the common case; food-weight tests opt in.
    food: over.food ?? null,
  }
}

const tentItem: SharedListResponse['items'][number] = {
  id: 'item-1',
  gearItemId: 'gear-1',
  quantity: 1,
  isWorn: false,
  isConsumable: false,
  sortOrder: 0,
  gear: {
    name: 'Tent',
    description: null,
    weightGrams: 1200,
    categoryId: 'cat-1',
  },
}

function renderShareView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/r/abc123']}>
        <Routes>
          <Route path="/r/:slug" element={<SharePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SharePage draft banner', () => {
  it('shows the work-in-progress banner when the shared list is a draft', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(share({ list: { isDraft: true } }))
    renderShareView()
    expect(await screen.findByText('Work in progress')).toBeTruthy()
  })

  it('omits the banner when the shared list is complete', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(share())
    renderShareView()
    expect(await screen.findByText('Trip')).toBeTruthy()
    expect(screen.queryByText('Work in progress')).toBeNull()
  })
})

describe('SharePage read-only public sharing', () => {
  it('shows a "Public - read-only" indicator without any edit/copy controls', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(share())
    renderShareView()

    expect(await screen.findByText('Public - read-only')).toBeTruthy()
    // Read-only stays read-only: no copy-to-my-account affordances (the
    // old repo shipped and deliberately REVERTED public gear-copy; see
    // the memory note - don't re-add these).
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /sign in to copy/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /edit/i })).toBeNull()
  })

  it('renders items grouped by category with the weight summary', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(
      share({
        categories: [{ id: 'cat-1', name: 'Shelter', sortOrder: 0 }],
        items: [
          tentItem,
          {
            ...tentItem,
            id: 'item-2',
            gearItemId: 'gear-2',
            sortOrder: 1,
            gear: { name: 'Mystery', description: null, weightGrams: 50, categoryId: null },
          },
        ],
      }),
    )
    renderShareView()

    expect(await screen.findByText('Tent')).toBeTruthy()
    // Category names appear twice by design: the section header and the
    // weight-table row.
    expect(screen.getAllByText('Shelter')).toHaveLength(2)
    // Orphan gear (null categoryId) lands in the trailing group.
    expect(screen.getAllByText('Uncategorized')).toHaveLength(2)
    expect(screen.getByText('Mystery')).toBeTruthy()
    expect(screen.getByText('Weight summary')).toBeTruthy()
  })

  it('honors groupWorn with a trailing Worn section', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(
      share({
        list: { groupWorn: true },
        categories: [{ id: 'cat-1', name: 'Shelter', sortOrder: 0 }],
        items: [tentItem, { ...tentItem, id: 'item-2', sortOrder: 1, isWorn: true }],
      }),
    )
    renderShareView()

    expect(await screen.findByText('Worn')).toBeTruthy()
  })

  it('shows an empty state when the shared gear list has no items', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(share())
    renderShareView()

    expect(
      await screen.findByText('No gear items have been added to this shared list yet.'),
    ).toBeTruthy()
  })
})

describe('SharePage error and not-found states', () => {
  it('shows "Couldn\'t load list" when the fetch rejects', async () => {
    // retry:false (set in renderShareView) means the rejection surfaces on
    // the first attempt, flipping isError true -> the error branch renders.
    vi.mocked(fetchSharedList).mockRejectedValueOnce(new Error('gateway timeout'))
    renderShareView()
    expect(await screen.findByText("Couldn't load list")).toBeTruthy()
  })

  it('shows "List not found" when the fetch resolves null (unknown/unshared slug)', async () => {
    // A successful fetch that returns null is the unknown-or-unshared-slug
    // case (fetchSharedList maps ONLY the 404 to null). The page
    // distinguishes this from a transient error: !share -> "List not
    // found", not "Couldn't load".
    vi.mocked(fetchSharedList).mockResolvedValueOnce(null)
    renderShareView()
    expect(await screen.findByText('List not found')).toBeTruthy()
  })
})
