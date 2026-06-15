// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FoodPlanDocument, List } from '../lib/types'

const {
  fetchFoodPlan,
  updateFoodPlanShare,
  updateList,
  invalidateFoodPlanCaches,
} = vi.hoisted(() => ({
  fetchFoodPlan: vi.fn(),
  updateFoodPlanShare: vi.fn(),
  updateList: vi.fn(),
  invalidateFoodPlanCaches: vi.fn(),
}))

vi.mock('../auth/use-require-session', () => ({
  useRequireSession: () => ({ userId: 'user-1', session: { user: { id: 'user-1' } } }),
}))

vi.mock('../lib/queries', () => ({
  queryKeys: {
    lists: () => ['lists'],
    foodPlan: (listId: string) => ['food-plan', listId],
  },
  updateList,
  fetchFoodPlan,
  updateFoodPlanShare,
  invalidateFoodPlanCaches,
  makeOptimisticUpdate: () => ({}),
}))

import PrivacyPanel from './PrivacyPanel'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const list: List = {
  id: 'list-1',
  user_id: 'user-1',
  name: 'Trip',
  description: null,
  slug: 'abc123',
  is_shared: true,
  sort_order: 0,
  group_worn: false,
  ready_checks_enabled: false,
  is_draft: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const doc: FoodPlanDocument = {
  plan: {
    id: 'plan-1',
    user_id: 'user-1',
    list_id: 'list-1',
    is_food_shared: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  meals: [],
  days: [],
  dayMeals: [],
  entries: [],
  dailyTargets: [],
  mealTargets: [],
}

function renderPanel(row: List = list) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <PrivacyPanel list={row} />
    </QueryClientProvider>,
  )
}

describe('PrivacyPanel Food plan sharing', () => {
  it('lets the owner include an existing food plan in the public link', async () => {
    fetchFoodPlan.mockResolvedValue(doc)
    updateFoodPlanShare.mockResolvedValue(undefined)
    invalidateFoodPlanCaches.mockResolvedValue(undefined)

    renderPanel()
    const user = userEvent.setup()

    const toggle = await screen.findByRole('switch', { name: 'Include food plan' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    await user.click(toggle)

    await waitFor(() => {
      expect(updateFoodPlanShare).toHaveBeenCalledWith('plan-1', true)
    })
    expect(invalidateFoodPlanCaches).toHaveBeenCalled()
  })

  it('explains that there is no food plan to include yet', async () => {
    fetchFoodPlan.mockResolvedValue(null)

    renderPanel()

    expect(await screen.findByText(/No food plan exists/i)).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Include food plan' })).toBeDisabled()
  })

  it('does not show the food-plan control while the public link is disabled', () => {
    renderPanel({ ...list, is_shared: false })

    expect(screen.queryByRole('switch', { name: 'Include food plan' })).toBeNull()
    expect(fetchFoodPlan).not.toHaveBeenCalled()
  })
})
