// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'

// Mock only the public fetchers SharePage calls. Do NOT importActual -
// the real ../lib/queries pulls in the Supabase client, which throws at import
// without env vars. No co-rendered child imports other ../lib/queries exports.
vi.mock('../lib/queries', () => ({
  queryKeys: {
    sharedFoodProjection: (slug: string) => ['shared-food-projection', slug],
    sharedFoodPlan: (slug: string) => ['shared-food-plan', slug],
  },
  fetchSharedList: vi.fn(),
  fetchSharedListItems: vi.fn(async () => []),
  fetchSharedListCategories: vi.fn(async () => []),
  fetchSharedFoodProjection: vi.fn(async () => []),
  fetchSharedFoodPlan: vi.fn(async () => null),
}))

import { fetchSharedFoodPlan, fetchSharedFoodProjection, fetchSharedList } from '../lib/queries'
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

describe('SharePage public food projection', () => {
  it('renders aggregate Food plan rows without the owner edit link', async () => {
    vi.mocked(fetchSharedList).mockResolvedValue({ ...baseList, is_draft: false })
    vi.mocked(fetchSharedFoodProjection).mockResolvedValue([
      {
        list_slug: 'abc123',
        food_name: 'Energy bar',
        brand: 'Trail Co',
        total_effective_servings: 2,
        total_weight_grams: 120,
      },
    ])

    renderShareView()

    expect(await screen.findByText('Food from plan')).toBeTruthy()
    expect(screen.getByText('Energy bar')).toBeTruthy()
    expect(screen.getByText('Trail Co')).toBeTruthy()
    expect(screen.getByText('2 servings')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /edit food plan/i })).toBeNull()
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

    renderShareView()

    await user.click(await screen.findByRole('button', { name: 'Food plan' }))

    expect(screen.getByRole('button', { name: 'Gear list' })).toBeTruthy()
    expect(screen.getByText('On-trail food')).toBeTruthy()
    expect(screen.getByText('Energy bar')).toBeTruthy()
    expect(screen.getByText('2 servings')).toBeTruthy()
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
