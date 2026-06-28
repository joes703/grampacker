// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { FoodItem, FoodPlanDocument, FoodPlanEntry } from '../lib/types'

const h = vi.hoisted(() => ({
  fetchFoodPlan: vi.fn(),
  fetchFoodItems: vi.fn(),
  fetchFoodItemsLite: vi.fn(),
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
    foodItemsLite: () => ['food-items-lite'] as const,
    foodPackSignatures: (listId: string) => ['food-pack-signatures', listId] as const,
    foodPackState: (listId: string) => ['food-pack-state', listId] as const,
  },
  fetchFoodPlan: h.fetchFoodPlan,
  fetchFoodItems: h.fetchFoodItems,
  fetchFoodItemsLite: h.fetchFoodItemsLite,
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
    h.fetchFoodItemsLite.mockResolvedValue([food({ id: 'bar', name: 'Bar' })])
    h.fetchFoodPackSignatures.mockResolvedValue([{ food_item_id: 'bar', current_signature: '80|40' }])
    h.fetchFoodPackState.mockResolvedValue([])
    h.setFoodPackState.mockResolvedValue({ food_item_id: 'bar', is_packed: true, packed_signature: '80|40' })
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useFoodProjection('u1', 'l1'), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.rows).toHaveLength(1))

    // The projection must read the lite query, never the full food-items fetch.
    expect(h.fetchFoodItemsLite).toHaveBeenCalledWith('u1')
    expect(h.fetchFoodItems).not.toHaveBeenCalled()

    act(() => result.current.togglePacked('bar', true))
    await waitFor(() => expect(h.setFoodPackState).toHaveBeenCalledWith('u1', 'l1', 'bar', true, '80|40'))

    h.setFoodPackState.mockResolvedValue({ food_item_id: 'bar', is_packed: false, packed_signature: '' })
    act(() => result.current.togglePacked('bar', false))
    await waitFor(() => expect(h.setFoodPackState).toHaveBeenCalledWith('u1', 'l1', 'bar', false, null))
  })

  it('reverts, refreshes, and toasts when the server rejects a stale signature', async () => {
    h.fetchFoodPlan.mockResolvedValue(doc([entry({ id: 'e1', food_item_id: 'bar', amount: 2 })]))
    h.fetchFoodItemsLite.mockResolvedValue([food({ id: 'bar', name: 'Bar' })])
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

  // The packing projection is the integration surface for "edit a food item from
  // the plan": that edit invalidates the lite + signature caches (asserted in
  // FoodPlanPage.test.tsx), and the refetched current_signature is what these
  // tests pin against the stored packed_signature. The row only reads as packed
  // when the two match, so a food edit that shifts the signature silently
  // un-packs the row until the user re-checks it.
  it('reads a row as packed when the stored signature still matches the current one', async () => {
    h.fetchFoodPlan.mockResolvedValue(doc([entry({ id: 'e1', food_item_id: 'bar', amount: 2 })]))
    h.fetchFoodItemsLite.mockResolvedValue([food({ id: 'bar', name: 'Bar' })])
    h.fetchFoodPackSignatures.mockResolvedValue([{ food_item_id: 'bar', current_signature: '80|40' }])
    h.fetchFoodPackState.mockResolvedValue([{ food_item_id: 'bar', is_packed: true, packed_signature: '80|40' }])
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useFoodProjection('u1', 'l1'), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    const [row] = result.current.rows
    if (row?.state !== 'complete') throw new Error('expected a complete row')
    expect(row.packed).toBe(true)
    expect(result.current.packedTotal).toBe(1)
  })

  it('treats a packed row as unpacked once a food edit makes the stored signature stale', async () => {
    h.fetchFoodPlan.mockResolvedValue(doc([entry({ id: 'e1', food_item_id: 'bar', amount: 2 })]))
    h.fetchFoodItemsLite.mockResolvedValue([food({ id: 'bar', name: 'Bar' })])
    // The food was edited (e.g. serving weight changed), so the refetched current
    // signature has moved on...
    h.fetchFoodPackSignatures.mockResolvedValue([{ food_item_id: 'bar', current_signature: '80|50' }])
    // ...but the stored pack state still carries the pre-edit signature.
    h.fetchFoodPackState.mockResolvedValue([{ food_item_id: 'bar', is_packed: true, packed_signature: '80|40' }])
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useFoodProjection('u1', 'l1'), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    const [row] = result.current.rows
    if (row?.state !== 'complete') throw new Error('expected a complete row')
    // Signature mismatch -> the row must NOT read as packed (recheck needed),
    // but it is still packable because it has a current signature.
    expect(row.packed).toBe(false)
    expect(row.packable).toBe(true)
    expect(result.current.packedTotal).toBe(0)
    expect(result.current.packableTotal).toBe(1)
  })

  it('drops packed + packable when a food edit leaves the food unpackable (null signature)', async () => {
    h.fetchFoodPlan.mockResolvedValue(doc([entry({ id: 'e1', food_item_id: 'bar', amount: 2 })]))
    h.fetchFoodItemsLite.mockResolvedValue([food({ id: 'bar', name: 'Bar' })])
    // A null current signature means the edited food is no longer packable...
    h.fetchFoodPackSignatures.mockResolvedValue([{ food_item_id: 'bar', current_signature: null }])
    // ...even though stale pack state still claims it was packed.
    h.fetchFoodPackState.mockResolvedValue([{ food_item_id: 'bar', is_packed: true, packed_signature: '80|40' }])
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useFoodProjection('u1', 'l1'), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    const [row] = result.current.rows
    if (row?.state !== 'complete') throw new Error('expected a complete row')
    expect(row.packable).toBe(false)
    expect(row.packed).toBe(false)
    expect(result.current.packedTotal).toBe(0)
  })

  it('returns the empty no-plan projection when the food plan is gone (post-delete)', async () => {
    // After Delete food plan, fetchFoodPlan(listId) refetches to null.
    h.fetchFoodPlan.mockResolvedValue(null)
    h.fetchFoodItemsLite.mockResolvedValue([])
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useFoodProjection('u1', 'l1'), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.hasPlan).toBe(false)
    expect(result.current.rows).toEqual([])
    expect(result.current.packableTotal).toBe(0)
    expect(result.current.packedTotal).toBe(0)
    // The lite food query is independent of the plan and intentionally starts
    // in parallel. Signatures and pack-state remain gated because they are
    // plan-scoped.
    expect(h.fetchFoodItemsLite).toHaveBeenCalledWith('u1')
    expect(h.fetchFoodPackSignatures).not.toHaveBeenCalled()
    expect(h.fetchFoodPackState).not.toHaveBeenCalled()
  })

  it('ignores lite-food failures when the list has no food plan', async () => {
    h.fetchFoodPlan.mockResolvedValue(null)
    h.fetchFoodItemsLite.mockRejectedValue(new Error('food library unavailable'))
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useFoodProjection('u1', 'l1'), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.hasPlan).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.rows).toEqual([])
    expect(h.fetchFoodItemsLite).toHaveBeenCalledWith('u1')
    expect(h.fetchFoodPackSignatures).not.toHaveBeenCalled()
    expect(h.fetchFoodPackState).not.toHaveBeenCalled()
  })
})
