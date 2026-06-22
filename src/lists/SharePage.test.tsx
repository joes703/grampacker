// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { PublicListItem } from '../lib/types'

// Mock only the public fetchers SharePage calls. Do NOT importActual -
// the real ../lib/queries pulls in the Supabase client, which throws at import
// without env vars. No co-rendered child imports other ../lib/queries exports.
vi.mock('../lib/queries', () => ({
  queryKeys: {
    sharedFoodSummary: (slug: string) => ['shared-food-summary', slug],
    sharedFoodPlan: (slug: string) => ['shared-food-plan', slug],
  },
  fetchSharedList: vi.fn(),
  fetchSharedListItems: vi.fn(async () => []),
  fetchSharedListCategories: vi.fn(async () => []),
  fetchSharedFoodSummary: vi.fn(async () => 0),
  fetchSharedFoodPlan: vi.fn(async () => null),
}))

import {
  fetchSharedFoodPlan,
  fetchSharedFoodSummary,
  fetchSharedList,
  fetchSharedListItems,
} from '../lib/queries'
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

const baseList = { id: 'list-1', name: 'Trip', description: null, group_worn: false, is_draft: false }

const sharedItem: PublicListItem = {
  id: 'item-1',
  gear_item_id: 'gear-1',
  quantity: 1,
  is_worn: false,
  is_consumable: false,
  sort_order: 0,
  gear_item: {
    id: 'gear-1',
    name: 'Tent',
    description: null,
    weight_grams: 1200,
    category_id: null,
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

describe('SharePage read-only public sharing', () => {
  it('shows a "Public - read-only" indicator in the share header without any edit/copy controls', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(baseList)
    renderShareView()

    expect(await screen.findByText('Public - read-only')).toBeTruthy()
    // The indicator communicates read-only sharing only; no write affordances appear.
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /sign in to copy/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /edit/i })).toBeNull()
  })

  it('does not offer public copy actions to signed-out viewers', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(baseList)
    renderShareView()

    expect(await screen.findByText('Trip')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Sign in to copy' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy gear list' })).toBeNull()
  })

  it('keeps public gear shares read-only even when food weight is shown', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue(baseList)
    vi.mocked(fetchSharedListItems).mockResolvedValue([sharedItem])
    vi.mocked(fetchSharedFoodSummary).mockResolvedValue(500)

    renderShareView()

    expect(await screen.findByText('Food')).toBeTruthy()
    expect(screen.getByText('From Food plan')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copy gear list' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Sign in to copy' })).toBeNull()
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

describe('SharePage public food summary', () => {
  it('shows one aggregate Food row with weight and no itemized food when the plan is private', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue({ ...baseList, is_draft: false })
    vi.mocked(fetchSharedFoodSummary).mockResolvedValue(318)
    vi.mocked(fetchSharedFoodPlan).mockResolvedValue(null) // is_food_shared = false

    renderShareView()

    expect(await screen.findByText('Food')).toBeTruthy()
    expect(screen.getByText('From Food plan')).toBeTruthy()
    // No itemization, and no detailed Food plan tab.
    expect(screen.queryByText('Energy bar')).toBeNull()
    expect(screen.queryByText('Trail Co')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Food plan' })).toBeNull()
    expect(screen.queryByText('Food from plan')).toBeNull() // old itemized header gone
  })

  it('omits the Food row when there is no food-plan weight', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue({ ...baseList, is_draft: false })
    vi.mocked(fetchSharedFoodSummary).mockResolvedValue(0)

    renderShareView()

    await screen.findByText('Trip')
    expect(screen.queryByText('From Food plan')).toBeNull()
  })
})

describe('SharePage public food plan tab', () => {
  it('renders the detailed Food plan tab when the owner includes it', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchSharedList).mockResolvedValue({ ...baseList, is_draft: false })
    vi.mocked(fetchSharedFoodPlan).mockResolvedValue({
      plan: { id: 'plan-1', list_slug: 'abc123' },
      meals: [{ id: 'meal-1', name: 'On-trail food', anchor_role: null, is_default: true, sort_order: 0 }],
      days: [{ id: 'day-1', day_type_override: null, sort_order: 0 }],
      dayMeals: [{ id: 'cell-1', day_id: 'day-1', meal_id: 'meal-1' }],
      entries: [{
        id: 'entry-1',
        day_meal_id: 'cell-1',
        is_extra: false,
        food_item_id: 'food-1',
        basis: 'servings',
        amount: 2,
        sort_order: 0,
      }],
      foods: [{
        id: 'food-1',
        name: 'Energy bar',
        brand: 'Trail Co',
        serving_description: 'bar',
        serving_weight_grams: 60,
        calories_per_serving: 260,
        servings_per_package: null,
        fat_grams: 9,
        saturated_fat_grams: null,
        carbs_grams: 35,
        fiber_grams: 4,
        sugar_grams: 12,
        protein_grams: 10,
        sodium_mg: 180,
        potassium_mg: null,
        sort_order: 0,
      }],
      dailyTargets: [],
      mealTargets: [],
    })
    vi.mocked(fetchSharedFoodSummary).mockResolvedValue(318)

    renderShareView()

    // Gear tab shows ONLY the aggregate Food row -- never the itemized menu,
    // even though the detailed plan is shared.
    expect(await screen.findByText('Food')).toBeTruthy()
    expect(screen.getByText('From Food plan')).toBeTruthy()
    expect(screen.queryByText('On-trail food')).toBeNull()

    await user.click(await screen.findByRole('button', { name: 'Food plan' }))

    expect(screen.getByRole('button', { name: 'Gear list' })).toBeTruthy()
    expect(screen.getByText('On-trail food')).toBeTruthy()
    expect(screen.getByText('Energy bar')).toBeTruthy()
    // The entry row prints the quantity in a desktop column AND a mobile
    // subtitle (only one is visible per viewport); both live in the DOM.
    expect(screen.getAllByText('2 servings').length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /edit food plan/i })).toBeNull()
  })

  it('does not show the Food plan tab when the owner has not included it', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue({ ...baseList, is_draft: false })
    vi.mocked(fetchSharedFoodPlan).mockResolvedValue(null)

    renderShareView()

    expect(await screen.findByText('Trip')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Food plan' })).toBeNull()
  })
})
