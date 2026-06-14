// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { FoodItem, FoodPlanDocument, FoodPlanEntry } from '../lib/types'

const h = vi.hoisted(() => ({
  fetchFoodPlan: vi.fn(),
  fetchFoodItems: vi.fn(),
  fetchFoodPackSignatures: vi.fn(),
  fetchFoodPackState: vi.fn(),
  setFoodPackState: vi.fn(),
  invalidateFoodPlanCaches: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../lib/queries', () => ({
  queryKeys: {
    foodPlan: (listId: string) => ['food-plan', listId] as const,
    foodItems: () => ['food-items'] as const,
    foodPackSignatures: (listId: string) => ['food-pack-signatures', listId] as const,
    foodPackState: (listId: string) => ['food-pack-state', listId] as const,
  },
  fetchFoodPlan: h.fetchFoodPlan,
  fetchFoodItems: h.fetchFoodItems,
  fetchFoodPackSignatures: h.fetchFoodPackSignatures,
  fetchFoodPackState: h.fetchFoodPackState,
  setFoodPackState: h.setFoodPackState,
  invalidateFoodPlanCaches: h.invalidateFoodPlanCaches,
}))

vi.mock('../lib/toast', () => ({ showToast: h.showToast }))

import { useFoodProjection } from './useFoodProjection'

const NOW = '2026-01-01T00:00:00.000Z'

function food(over: Partial<FoodItem> & { id: string; name: string }): FoodItem {
  return {
    user_id: 'u1',
    brand: null,
    serving_description: null,
    serving_weight_grams: 40,
    calories_per_serving: 100,
    servings_per_package: null,
    fat_grams: null,
    saturated_fat_grams: null,
    carbs_grams: null,
    fiber_grams: null,
    sugar_grams: null,
    protein_grams: null,
    sodium_mg: null,
    potassium_mg: null,
    notes: null,
    sort_order: 0,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  }
}

function doc(entries: FoodPlanEntry[]): FoodPlanDocument {
  return {
    plan: { id: 'p1', user_id: 'u1', list_id: 'l1', is_food_shared: false, created_at: NOW, updated_at: NOW },
    meals: [],
    days: [],
    dayMeals: [],
    entries,
    dailyTargets: [],
    mealTargets: [],
  }
}

function entry(over: Partial<FoodPlanEntry> & { id: string; food_item_id: string }): FoodPlanEntry {
  return {
    user_id: 'u1',
    food_plan_id: 'p1',
    day_meal_id: null,
    is_extra: true,
    basis: 'servings',
    amount: 1,
    sort_order: 0,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  }
}

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return {
    qc,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useFoodProjection', () => {
  it('packs with the cached server signature and unpacks with null', async () => {
    h.fetchFoodPlan.mockResolvedValue(doc([entry({ id: 'e1', food_item_id: 'bar', amount: 2 })]))
    h.fetchFoodItems.mockResolvedValue([food({ id: 'bar', name: 'Bar' })])
    h.fetchFoodPackSignatures.mockResolvedValue([{ food_item_id: 'bar', current_signature: '80|40' }])
    h.fetchFoodPackState.mockResolvedValue([])
    h.setFoodPackState.mockResolvedValue({ food_item_id: 'bar', is_packed: true, packed_signature: '80|40' })
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useFoodProjection('u1', 'l1'), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.rows).toHaveLength(1))

    act(() => result.current.togglePacked('bar', true))
    await waitFor(() => expect(h.setFoodPackState).toHaveBeenCalledWith('u1', 'l1', 'bar', true, '80|40'))

    h.setFoodPackState.mockResolvedValue({ food_item_id: 'bar', is_packed: false, packed_signature: '' })
    act(() => result.current.togglePacked('bar', false))
    await waitFor(() => expect(h.setFoodPackState).toHaveBeenCalledWith('u1', 'l1', 'bar', false, null))
  })

  it('reverts, refreshes, and toasts when the server rejects a stale signature', async () => {
    h.fetchFoodPlan.mockResolvedValue(doc([entry({ id: 'e1', food_item_id: 'bar', amount: 2 })]))
    h.fetchFoodItems.mockResolvedValue([food({ id: 'bar', name: 'Bar' })])
    h.fetchFoodPackSignatures.mockResolvedValue([{ food_item_id: 'bar', current_signature: '80|40' }])
    h.fetchFoodPackState.mockResolvedValue([])
    const err = new Error('stale') as Error & { code: string }
    err.code = 'PT409'
    h.setFoodPackState.mockRejectedValue(err)
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useFoodProjection('u1', 'l1'), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.rows).toHaveLength(1))

    act(() => result.current.togglePacked('bar', true))

    await waitFor(() => expect(h.invalidateFoodPlanCaches).toHaveBeenCalledWith(expect.any(QueryClient), 'l1'))
    expect(h.showToast).toHaveBeenCalledWith(
      "This food's quantity changed. We refreshed it - check the new amount and pack again.",
      { type: 'error' },
    )
  })
})
