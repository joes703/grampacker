// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'

// Mock only the three public fetchers SharePage calls. Do NOT importActual -
// the real ../lib/queries pulls in the Supabase client, which throws at import
// without env vars. No co-rendered child imports other ../lib/queries exports.
vi.mock('../lib/queries', () => ({
  fetchSharedList: vi.fn(),
  fetchSharedListItems: vi.fn(async () => []),
  fetchSharedListCategories: vi.fn(async () => []),
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

const baseList = { id: 'list-1', name: 'Trip', description: null, group_worn: false }

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
    vi.mocked(fetchSharedList).mockResolvedValue({ ...baseList, is_draft: true })
    renderShareView()
    expect(await screen.findByText('Work in progress')).toBeTruthy()
  })

  it('omits the banner when the shared list is complete', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue({ ...baseList, is_draft: false })
    renderShareView()
    expect(await screen.findByText('Trip')).toBeTruthy()
    expect(screen.queryByText('Work in progress')).toBeNull()
  })
})

describe('SharePage error and not-found states', () => {
  it('shows "Couldn\'t load list" when the list fetch rejects', async () => {
    // retry:false (set in renderShareView) means the rejection surfaces on
    // the first attempt, flipping listError true -> the error branch renders.
    vi.mocked(fetchSharedList).mockRejectedValueOnce(new Error('gateway timeout'))
    renderShareView()
    expect(await screen.findByText("Couldn't load list")).toBeTruthy()
  })

  it('shows "List not found" when the list fetch resolves null (unknown/unshared slug)', async () => {
    // A successful fetch that returns null is the unknown-or-unshared-slug
    // case (fetchSharedList maps PGRST116 to null). The page distinguishes
    // this from a transient error: !list -> "List not found", not "Couldn't load".
    vi.mocked(fetchSharedList).mockResolvedValueOnce(null)
    renderShareView()
    expect(await screen.findByText('List not found')).toBeTruthy()
  })
})
