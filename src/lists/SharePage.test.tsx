// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SHARE_WEIGHT_UNIT_KEY, WEIGHT_UNIT_KEY } from '../lib/weight'
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
      isDraft: false,
      ...over.list,
    },
    categories: over.categories ?? [],
    items: over.items ?? [],
    food: over.food ?? { items: [] },
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
  it('stays read-only without showing a redundant public-view label or edit controls', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(share())
    renderShareView()

    expect(await screen.findByText('Trip')).toBeTruthy()
    expect(screen.queryByText('Public - read-only')).toBeNull()
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

  it('always renders worn gear in a trailing Worn section', async () => {
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
            isWorn: true,
            gear: { ...tentItem.gear, name: 'Rain jacket' },
          },
        ],
      }),
    )
    renderShareView()

    const wornItem = await screen.findByText('Rain jacket')
    const wornSection = wornItem.closest('.overflow-hidden')
    expect(wornSection?.textContent).toContain('Worn')
    expect(screen.getAllByText('Rain jacket')).toHaveLength(1)
  })

  // Food used to cross this boundary as a single number: the share showed a
  // total that counted food while showing nothing that accounted for it.
  // Rows now cross, and this is the surface where that decision is visible.
  it('renders shared food as its own trailing section of rows', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(
      share({
        categories: [{ id: 'cat-1', name: 'Shelter', sortOrder: 0 }],
        items: [tentItem],
        food: {
          items: [
            { id: 'f1', name: 'Oatmeal', quantity: 3, weightGrams: 90, sortOrder: 0 },
            { id: 'f2', name: 'Trail mix', quantity: 1, weightGrams: 200, sortOrder: 1 },
          ],
        },
      }),
    )
    renderShareView()

    expect(await screen.findByText('Oatmeal')).toBeTruthy()
    expect(screen.getByText('Trail mix')).toBeTruthy()
    // Trailing: after the gear sections, not mixed into one of them. Food has
    // no category and grouping it under one would invent a fact.
    const food = screen.getByText('Oatmeal').closest('.overflow-hidden')
    expect(food?.textContent).toContain('Food')
    expect(food?.textContent).not.toContain('Tent')
    // Found in review: routing the food subtotal through `subtotalGrams`
    // printed "Worn" under it, because that prop is the Worn section's
    // channel and the footer hardcodes the label.
    expect(food?.textContent).toContain('Consumable')
    expect(food?.textContent).not.toContain('Worn')
  })

  // The number the reader actually sees. It is summed from the rows, by the
  // same helper the owner's page uses - the point of publishing rows rather
  // than a server-computed aggregate is that there is one definition of this
  // figure and it cannot drift between the two views of one list.
  it('counts food toward the published total, summing rows and not slots', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(
      share({
        items: [tentItem],
        food: {
          items: [
            // 3 x 90 = 270, not 90. Quantity is the multiplier; the meal
            // schedule that would multiply it further is not on this wire.
            { id: 'f1', name: 'Oatmeal', quantity: 3, weightGrams: 90, sortOrder: 0 },
          ],
        },
      }),
    )
    renderShareView()

    await screen.findByText('Oatmeal')
    const summary = screen.getByText('Weight summary').closest('div')?.parentElement
    // Tent 1200 g base + oatmeal 3 x 90 = 270 g consumable, total 1470 g.
    // Asserted through the rendered figures rather than a computed constant,
    // so a breakdown that dropped food - or that counted it as base weight -
    // fails here.
    expect(summary?.textContent).toContain('Consumables270 g')
    expect(summary?.textContent).toContain('Total pack weight1470 g')
    expect(summary?.textContent).toContain('Base weight1200 g')
  })

  // A trip can be food-only - a resupply box, or a list started from the
  // meal plan. Keying the sections block on gear alone hid the food section
  // completely for exactly that list.
  it('renders the food section for a list that has food and no gear', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(
      share({
        items: [],
        food: {
          items: [{ id: 'f1', name: 'Oatmeal', quantity: 1, weightGrams: 90, sortOrder: 0 }],
        },
      }),
    )
    renderShareView()

    expect(await screen.findByText('Oatmeal')).toBeTruthy()
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

// Parent-level wiring for the per-section footer subtotals. CategoryGroup's own
// tests prove it renders what it is handed; only a test at this level can prove
// the PARENT hands each section the right number. The failure modes are all
// silent and plausible-looking: passing a null category lookup to the Worn
// section (which would show Uncategorized's base), passing the wrong category
// id.
describe('SharePage category subtotals', () => {
  const shelterBase: SharedListResponse['items'][number] = {
    id: 'i-base', gearItemId: 'g-base', quantity: 1, isWorn: false, isConsumable: false, sortOrder: 0,
    gear: { name: 'Tent', description: null, weightGrams: 1200, categoryId: 'cat-1' },
  }
  const shelterConsumable: SharedListResponse['items'][number] = {
    id: 'i-cons', gearItemId: 'g-cons', quantity: 1, isWorn: false, isConsumable: true, sortOrder: 1,
    gear: { name: 'Gas', description: null, weightGrams: 230, categoryId: 'cat-1' },
  }
  const shelterWorn: SharedListResponse['items'][number] = {
    id: 'i-worn', gearItemId: 'g-worn', quantity: 1, isWorn: true, isConsumable: false, sortOrder: 2,
    gear: { name: 'Jacket', description: null, weightGrams: 550, categoryId: 'cat-1' },
  }
  const orphan: SharedListResponse['items'][number] = {
    id: 'i-orphan', gearItemId: 'g-orphan', quantity: 2, isWorn: false, isConsumable: false, sortOrder: 3,
    // Category id that is NOT in `categories` - must route to Uncategorized in
    // BOTH the grouper and the subtotal lookup, or the section renders against
    // a bucket it does not own.
    gear: { name: 'Mystery', description: null, weightGrams: 40, categoryId: 'cat-gone' },
  }

  it('gives each section its nonzero base and consumable weights, excluding worn', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(
      share({
        categories: [{ id: 'cat-1', name: 'Shelter', sortOrder: 0 }],
        items: [shelterBase, shelterConsumable, shelterWorn, orphan],
      }),
    )
    renderShareView()

    // Shelter holds 1200 base + 230 consumable + 550 worn. Its footer reports
    // the first two buckets separately; 1980 g (the row sum) must appear nowhere.
    expect((await screen.findAllByText('Shelter')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('1200 g').length).toBeGreaterThan(0)
    expect(screen.queryByText('1980 g')).toBeNull()
    // Orphan: 2 x 40 g, routed to Uncategorized by both paths.
    expect(screen.getAllByText('80 g').length).toBeGreaterThan(0)
    // Scope the assertion to a section footer. The Weight summary above also
    // contains these labels and values, so page-wide queries would stay green
    // if SharePage forgot to wire the new footer props.
    const footers = [...document.querySelectorAll('.print\\:flex')]
      .map((footer) => footer.textContent ?? '')
    expect(footers.some((text) =>
      text.includes('Base')
      && text.includes('1200 g')
      && text.includes('Consumable')
      && text.includes('230 g')
    )).toBe(true)
  })

  it('does not give the Worn section the Uncategorized base figure', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(
      share({
        categories: [{ id: 'cat-1', name: 'Shelter', sortOrder: 0 }],
        // Uncategorized base is 80 g; worn is 550 g. If the Worn section were
        // looked up with a null categoryId it would render 80 g here.
        items: [shelterBase, shelterWorn, orphan],
      }),
    )
    renderShareView()

    const wornItem = await screen.findByText('Jacket')
    expect(screen.getAllByText('550 g').length).toBeGreaterThan(0)
    // 80 g still appears (it is Uncategorized's own legitimate subtotal), so
    // assert the Worn section specifically does not contain it.
    const wornSection = wornItem.closest('.overflow-hidden')
    expect(wornSection?.textContent).toContain('550 g')
    expect(wornSection?.textContent).not.toContain('80 g')
  })
})

// The unit control on the public page. SharePage.test previously did not
// exercise the switcher at all, which is how it went unnoticed that the public
// page was writing the authenticated app's preference key - and that it was the
// only unit switcher in the entire product.
describe('SharePage unit control isolation', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('changes the displayed units without touching the app-wide preference', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(
      share({
        categories: [{ id: 'cat-1', name: 'Shelter', sortOrder: 0 }],
        items: [tentItem],
      }),
    )
    localStorage.setItem(WEIGHT_UNIT_KEY, 'g')
    renderShareView()

    expect((await screen.findAllByText('Shelter')).length).toBeGreaterThan(0)
    // Scope to the category section footer. The summary WeightTable renders a
    // grams AND an ounces column unconditionally, so document-wide assertions
    // on '1200 g' prove nothing about the preference.
    const footer = () => document.querySelector('.print\\:flex')?.textContent ?? ''
    expect(footer()).toMatch(/1200 g/)

    // A visitor switches to imperial.
    fireEvent.click(screen.getByTitle('Imperial'))

    // The section follows...
    expect(footer()).not.toMatch(/1200 g/)
    expect(footer()).toMatch(/oz/)
    // ...the share-scoped key records it...
    expect(localStorage.getItem(SHARE_WEIGHT_UNIT_KEY)).toBe('oz')
    // ...and the signed-in app's preference is untouched. This is the assertion
    // the whole change exists for.
    expect(localStorage.getItem(WEIGHT_UNIT_KEY)).toBe('g')
  })

  it('starts from the app preference when the viewer has no share choice yet', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(
      share({
        categories: [{ id: 'cat-1', name: 'Shelter', sortOrder: 0 }],
        items: [tentItem],
      }),
    )
    localStorage.setItem(WEIGHT_UNIT_KEY, 'oz')
    renderShareView()

    // Owner opening their own link sees their usual units, not a reset to g.
    expect((await screen.findAllByText('Shelter')).length).toBeGreaterThan(0)
    const footer = document.querySelector('.print\\:flex')?.textContent ?? ''
    expect(footer).not.toMatch(/1200 g/)
    expect(footer).toMatch(/oz/)
  })
})
