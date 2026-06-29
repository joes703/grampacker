// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { FoodPlanDocument as Doc } from '../lib/types'
import type { TargetsSavePayload } from '../lib/queries'

// The plan-level mutations were inline in FoodPlanDocument (only the queries were
// mocked at the page level). This locks the logic the extraction exposed:
// saveTargetsMut routes through the shared invalidate callback, while
// deletePlanMut fans its invalidation across the plan caches, the pack state, and
// this user's copy options - and does NOT add any food-item cache invalidation.
//
// queryKeys.foodPackState is stubbed to the real ['food-pack-state', listId]
// shape (keys.ts) so the deletePlanMut assertions read against the real key.
// Mocks are typed via vi.fn<FnType>() so tsc -b accepts `.mock.calls` tuples.
const h = vi.hoisted(() => ({
  saveFoodPlanTargets: vi.fn<(userId: string, planId: string, payload: unknown) => Promise<void>>(),
  deleteFoodPlan: vi.fn<(planId: string) => Promise<void>>(),
  invalidateFoodPlanCaches: vi.fn<(qc: unknown, listId: string) => void>(),
  queryKeys: { foodPackState: (listId: string) => ['food-pack-state', listId] as const },
}))

vi.mock('../lib/queries', () => h)

import { useFoodPlanPlanActions } from './use-food-plan-plan-actions'

const NOW = '2026-01-01T00:00:00.000Z'

const EMPTY_TARGETS: TargetsSavePayload = {
  dailyUpserts: [], dailyDeletes: [], mealUpserts: [], mealDeletes: [],
}

function doc(): Doc {
  return {
    plan: { id: 'p1', user_id: 'u1', list_id: 'L1', is_food_shared: false, created_at: NOW, updated_at: NOW },
    meals: [], days: [], dayMeals: [], entries: [], dailyTargets: [], mealTargets: [],
  }
}

function setup() {
  // A real QueryClient drives the useMutation machinery via context; a separate
  // mock client is passed in as the invalidation target so the deletePlanMut
  // assertions can read its invalidateQueries calls directly.
  const realQc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient
  const invalidate = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={realQc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(
    () => useFoodPlanPlanActions({ userId: 'u1', listId: 'L1', currentDoc: doc(), queryClient: qc, invalidate }),
    { wrapper },
  )
  return { result, qc, invalidate }
}

afterEach(() => vi.clearAllMocks())

describe('useFoodPlanPlanActions', () => {
  describe('saveTargetsMut', () => {
    it('saves targets for the plan and invalidates via the shared callback', async () => {
      const { result, invalidate } = setup()

      result.current.saveTargetsMut.mutate(EMPTY_TARGETS)

      await waitFor(() => expect(h.saveFoodPlanTargets).toHaveBeenCalledWith('u1', 'p1', EMPTY_TARGETS))
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    })
  })

  describe('deletePlanMut', () => {
    it('deletes the plan and fans invalidation across plan caches, pack state, and copy options', async () => {
      const { result, qc } = setup()

      result.current.deletePlanMut.mutate()

      await waitFor(() => expect(h.deleteFoodPlan).toHaveBeenCalledWith('p1'))
      // food-plan caches for the list (via the shared helper, not the callback).
      await waitFor(() => expect(h.invalidateFoodPlanCaches).toHaveBeenCalledWith(qc, 'L1'))
      // pack state for the list + this user's copy-options prefix (every target list).
      expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['food-pack-state', 'L1'] })
      expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['food-plan-copy-options', 'u1'] })
    })

    it('adds no food-item cache invalidation and does not use the shared callback', async () => {
      const { result, qc, invalidate } = setup()

      result.current.deletePlanMut.mutate()

      await waitFor(() => expect(h.deleteFoodPlan).toHaveBeenCalled())
      // exactly the two explicit invalidateQueries (pack state + copy options);
      // no food-items / lite / signature keys are added.
      await waitFor(() => expect(qc.invalidateQueries).toHaveBeenCalledTimes(2))
      // deletePlanMut owns its invalidation directly; the shared callback is unused.
      expect(invalidate).not.toHaveBeenCalled()
    })
  })
})
