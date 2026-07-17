// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { FoodItem } from '../lib/types'
import type { FoodPlanDocument } from '../../shared/food-plans'

// The cache lifecycle IS the contract here (same rationale as
// use-list-reset-actions.test.tsx): a REAL QueryClient seeded with the plan
// document, the food library, and the pack id set; only the fetchers and the
// toast are mocked. The row derivation runs the REAL selectors, so these
// tests also pin that the hook feeds them correctly.

const LIST_ID = 'list-1'
const PLAN_ID = 'plan-1'
const PACK_KEY = ['food-pack', LIST_ID, PLAN_ID] as const

const h = vi.hoisted(() => ({
  queryKeys: {
    lists: () => ['lists'] as const,
    foodItems: () => ['food-items'] as const,
    foodPlan: (planId: string | undefined) => ['food-plan', planId] as const,
    foodPackState: (listId: string, foodPlanId: string) =>
      ['food-pack', listId, foodPlanId] as const,
  },
  fetchFoodPlan: vi.fn<(id: string) => Promise<FoodPlanDocument>>(),
  fetchFoodItems: vi.fn<() => Promise<FoodItem[]>>(),
  fetchFoodPackState: vi.fn<(id: string) => Promise<{ packedFoodItemIds: string[] }>>(),
  toggleFoodPack:
    vi.fn<(id: string, foodItemId: string, packed: boolean, expectedFoodPlanId: string) => Promise<{ foodItemId: string; packed: boolean; applied: boolean }>>(),
}))
const toast = vi.hoisted(() => ({ showToast: vi.fn<(message: string, options?: unknown) => number>() }))

vi.mock('../lib/queries', () => h)
vi.mock('../lib/toast', () => toast)

import { useFoodPack } from './use-food-pack'

function food(id: string, servingWeightGrams: number): FoodItem {
  return {
    id,
    name: `Food ${id}`,
    brand: null,
    servingDescription: null,
    servingWeightGrams,
    caloriesPerServing: 100,
    servingsPerPackage: null,
    fatGrams: null,
    saturatedFatGrams: null,
    carbsGrams: null,
    fiberGrams: null,
    sugarGrams: null,
    proteinGrams: null,
    sodiumMg: null,
    potassiumMg: null,
    notes: null,
    sortOrder: 0,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  }
}

// One day, one meal, entries for f1 and f2 plus one whose food is missing
// from the library cache (still a row, still packable - nothing blocks
// packing).
function planDoc(): FoodPlanDocument {
  return {
    id: PLAN_ID,
    name: 'Trip food',
    sortOrder: 0,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    meals: [
      { id: 'm1', name: 'Dinner', anchorRole: 'dinner', isDefault: true, sortOrder: 0 },
    ],
    days: [{ id: 'd1', dayTypeOverride: null, sortOrder: 0 }],
    dayMeals: [{ id: 'c1', dayId: 'd1', mealId: 'm1' }],
    entries: [
      { id: 'e1', dayMealId: 'c1', isExtra: false, foodItemId: 'f1', basis: 'servings', amount: 1, sortOrder: 0 },
      { id: 'e2', dayMealId: 'c1', isExtra: false, foodItemId: 'f2', basis: 'servings', amount: 1, sortOrder: 1 },
      { id: 'e3', dayMealId: 'c1', isExtra: false, foodItemId: 'f-gone', basis: 'servings', amount: 1, sortOrder: 2 },
    ],
    usedByList: null,
  }
}

function setup(packedIds: string[] = []) {
  serverIds = [...packedIds]
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  qc.setQueryData(['food-plan', PLAN_ID], planDoc())
  qc.setQueryData(['food-items'], [food('f1', 50), food('f2', 60)])
  qc.setQueryData(PACK_KEY, packedIds)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result, rerender } = renderHook(
    ({ planId }: { planId: string }) => useFoodPack(LIST_ID, planId, true),
    { wrapper, initialProps: { planId: PLAN_ID } },
  )
  return { qc, result, rerender }
}

const readIds = (qc: QueryClient) => qc.getQueryData<string[]>(PACK_KEY) ?? []

// A minimal fake server for the pack id set: the toggle mock mutates it and
// the fetch mock reads it, so the invalidation refetch after a settle
// returns TRUTH rather than clobbering the state under assertion (the
// mocked-clients-assert-my-beliefs trap; a fixed [] here masked rollback
// bugs by wiping the cache after every toggle).
let serverIds: string[] = []

beforeEach(() => {
  h.fetchFoodPlan.mockResolvedValue(planDoc())
  h.fetchFoodItems.mockResolvedValue([food('f1', 50), food('f2', 60)])
  h.fetchFoodPackState.mockImplementation(async () => ({
    packedFoodItemIds: [...serverIds],
  }))
  h.toggleFoodPack.mockImplementation(async (_id, foodItemId, packed) => {
    serverIds = packed
      ? serverIds.includes(foodItemId) ? serverIds : [...serverIds, foodItemId]
      : serverIds.filter((id) => id !== foodItemId)
    return { foodItemId, packed, applied: true }
  })
})

afterEach(() => vi.clearAllMocks())

describe('useFoodPack', () => {
  it('derives one row per plan food with totals counting every row', () => {
    const { result } = setup(['f2'])
    expect(result.current.rows.map((r) => [r.foodItemId, r.name, r.packed])).toEqual([
      ['f1', 'Food f1', false],
      ['f2', 'Food f2', true],
      ['f-gone', null, false],
    ])
    // Nothing blocks packing: the missing-name row counts in the totals.
    expect(result.current.packableTotal).toBe(3)
    expect(result.current.packedTotal).toBe(1)
  })

  it('optimistically adds the id on pack and removes it on unpack', async () => {
    const { qc, result } = setup(['f2'])
    await act(async () => { result.current.toggle('f1', true) })
    expect(readIds(qc)).toContain('f1')
    await act(async () => { result.current.toggle('f2', false) })
    expect(readIds(qc)).not.toContain('f2')
  })

  it('sends the observed plan link as the CAS expectation', async () => {
    const { result } = setup()
    await act(async () => { result.current.toggle('f1', true) })
    expect(h.toggleFoodPack).toHaveBeenCalledWith(LIST_ID, 'f1', true, PLAN_ID)
  })

  it('rolls back ONLY the failed toggle; a concurrent tick survives', async () => {
    const { qc, result } = setup()
    let rejectF1!: (err: Error) => void
    let resolveF2!: (v: { foodItemId: string; packed: boolean; applied: boolean }) => void
    h.toggleFoodPack.mockImplementation((_id, foodItemId) => {
      if (foodItemId === 'f1') {
        return new Promise((_res, rej) => { rejectF1 = rej })
      }
      return new Promise((res) => { resolveF2 = res })
    })

    // await act flushes the async onMutate (it awaits cancelQueries) without
    // waiting on the still-deferred mutationFn promises.
    await act(async () => { result.current.toggle('f1', true) })
    await act(async () => { result.current.toggle('f2', true) })
    expect(readIds(qc)).toEqual(['f1', 'f2'])

    await act(async () => { rejectF1(new Error('network')) })
    // f1's tick is gone, f2's optimistic tick is untouched.
    expect(readIds(qc)).toEqual(['f2'])
    expect(toast.showToast).toHaveBeenCalledWith(
      "Couldn't update packing. Please try again.",
      { type: 'error' },
    )

    // The deferred mock bypassed the fake server; record f2's landing so the
    // last-one-out invalidation refetch returns what the server now holds.
    serverIds = ['f2']
    await act(async () => { resolveF2({ foodItemId: 'f2', packed: true, applied: true }) })
    expect(readIds(qc)).toEqual(['f2'])
  })

  it('applied:false rolls the tick back and resyncs the moved plan link', async () => {
    const { qc, result } = setup()
    h.toggleFoodPack.mockResolvedValue({ foodItemId: 'f1', packed: true, applied: false })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')

    await act(async () => { result.current.toggle('f1', true) })

    await waitFor(() => expect(readIds(qc)).toEqual([]))
    // The link moved server-side: the lists cache (foodPlanId) must refetch.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['lists'] })
    expect(toast.showToast).toHaveBeenCalledWith(
      "This list's food plan changed, so that checkmark didn't stick.",
      { type: 'error' },
    )
  })

  it("applied:false does not invalidate pack state over a pending sibling's tick", async () => {
    // The lost-CAS resync must flow through the SAME last-one-out gate as
    // every other settle: an eager pack-state invalidate here can refetch
    // pre-toggle server state over a still-pending sibling's checkmark.
    const { qc, result } = setup()
    let resolveF2!: (v: { foodItemId: string; packed: boolean; applied: boolean }) => void
    h.toggleFoodPack.mockImplementation((_id, foodItemId) => {
      if (foodItemId === 'f1') {
        return Promise.resolve({ foodItemId: 'f1', packed: true, applied: false })
      }
      return new Promise((res) => { resolveF2 = res })
    })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')

    await act(async () => { result.current.toggle('f2', true) }) // sibling, deferred
    await act(async () => { result.current.toggle('f1', true) }) // lost CAS

    await waitFor(() => expect(readIds(qc)).toEqual(['f2'])) // f1 rolled back
    const packInvalidations = () =>
      invalidate.mock.calls.filter(
        ([arg]) => JSON.stringify(arg?.queryKey) === JSON.stringify(PACK_KEY),
      ).length
    expect(packInvalidations()).toBe(0)

    serverIds = ['f2']
    await act(async () => { resolveF2({ foodItemId: 'f2', packed: true, applied: true }) })
    // The last one out reconciles for the whole burst.
    await waitFor(() => expect(packInvalidations()).toBeGreaterThan(0))
    expect(readIds(qc)).toEqual(['f2'])
  })

  it("a pending old-plan toggle does not suppress the new plan's reconciliation", async () => {
    // The last-one-out gate must count siblings PER PLAN GENERATION. With a
    // list-wide gate, a slow old-plan mutation makes every new-plan settle
    // skip its invalidation, and the old mutation's own settle reconciles
    // only the old key - the new plan's cache could stay divergent from
    // server truth indefinitely.
    const { qc, result, rerender } = setup()
    let resolveOld!: (v: { foodItemId: string; packed: boolean; applied: boolean }) => void
    h.toggleFoodPack.mockImplementation((_id, foodItemId, packed) => {
      if (foodItemId === 'f1') {
        return new Promise((res) => { resolveOld = res })
      }
      return Promise.resolve({ foodItemId, packed, applied: true })
    })

    await act(async () => { result.current.toggle('f1', true) }) // old plan, deferred
    rerender({ planId: 'plan-b' })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')

    await act(async () => { result.current.toggle('f2', true) }) // new plan, settles
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['food-pack', LIST_ID, 'plan-b'],
      }),
    )

    await act(async () => { resolveOld({ foodItemId: 'f1', packed: true, applied: true }) })
  })

  it("never renders another plan's cached pack state, and counts packables before the id set loads", async () => {
    // The phantom pre-check rule 1 exists to prevent: ramen packed under
    // plan A must not appear checked after relinking to plan B. The plan id
    // is part of the cache key, so plan B's render CANNOT read A's entry -
    // it starts with no id set at all. While that set is in flight the
    // checklist stays empty (no all-unchecked flash), but packableTotal is
    // already derived from the plan document + library so the progress
    // denominator does not jump when the ids land.
    serverIds = []
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    qc.setQueryData(['food-plan', PLAN_ID], planDoc())
    qc.setQueryData(['food-items'], [food('f1', 50), food('f2', 60)])
    // A stale entry from the PREVIOUS plan, still holding a checkmark.
    qc.setQueryData(['food-pack', LIST_ID, 'plan-old'], ['f1'])
    // Defer the id-set fetch so the in-flight window is observable.
    let resolveFetch!: (v: { packedFoodItemIds: string[] }) => void
    h.fetchFoodPackState.mockImplementation(
      () => new Promise((res) => { resolveFetch = res }),
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useFoodPack(LIST_ID, PLAN_ID, true), {
      wrapper,
    })

    expect(result.current.rows).toEqual([])
    expect(result.current.packedTotal).toBe(0)
    expect(result.current.packableTotal).toBe(3)

    await act(async () => { resolveFetch({ packedFoodItemIds: [] }) })
    await waitFor(() =>
      expect(result.current.rows.map((r) => [r.foodItemId, r.packed])).toEqual([
        ['f1', false],
        ['f2', false],
        ['f-gone', false],
      ]),
    )
  })
})
