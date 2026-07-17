// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { ListItemWithGear } from '../lib/types'

// resetPacked / resetReady were inline in ListDetailPage (which has no component
// test), so this is coverage for their field-scoped optimistic rollback - the
// subtle part is that each reset only restores its OWN field on failure, so a
// failing reset never stomps the other reset's clear. We drive the hook with a
// REAL QueryClient (seeded via setQueryData) and mock only the fetch helpers +
// toast, because the cache cancel/snapshot/clear/rollback/invalidate lifecycle
// IS the contract here, not an implementation detail to stub out.
//
// Since slice 4b, resetPacked also spans the food checklist ("Reset packed
// spans both", design 8): an independent optimistic clear of the
// ['food-pack', listId] id cache with its own per-side rollback.

const LIST_ID = 'list-1'
const KEY = ['list-items', LIST_ID] as const
const FOOD_KEY = ['food-pack', LIST_ID] as const

const h = vi.hoisted(() => ({
  queryKeys: {
    listItems: (id: string) => ['list-items', id] as const,
    foodPackState: (id: string) => ['food-pack', id] as const,
  },
  resetPackedForList: vi.fn<(listId: string) => Promise<void>>(),
  resetReadyForList: vi.fn<(listId: string) => Promise<void>>(),
  resetFoodPackForList: vi.fn<(listId: string) => Promise<void>>(),
}))
const toast = vi.hoisted(() => ({ showToast: vi.fn<(message: string, options?: unknown) => number>() }))

vi.mock('../lib/queries', () => h)
vi.mock('../lib/toast', () => toast)

import { useListResetActions } from './use-list-reset-actions'

function item(over: Partial<ListItemWithGear> = {}): ListItemWithGear {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: 'i1', listId: LIST_ID, gearItemId: 'g1',
    gearItem: {
      id: 'g1', name: 'Tent', description: null, weightGrams: 1200,
      categoryId: 'c1', status: 'active', cost: null, purchaseDate: null,
      sortOrder: 0, createdAt: now, updatedAt: now,
    },
    quantity: 1, isWorn: false, isConsumable: false, isPacked: false, isReady: false,
    sortOrder: 0, createdAt: now, updatedAt: now, ...over,
  }
}

function setup(
  items: ListItemWithGear[],
  opts: { hasFoodPlan?: boolean; packedFoodIds?: string[] } = {},
) {
  const { hasFoodPlan = false, packedFoodIds = [] } = opts
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  qc.setQueryData<ListItemWithGear[]>(KEY, items)
  qc.setQueryData<string[]>(FOOD_KEY, packedFoodIds)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useListResetActions(LIST_ID, hasFoodPlan), { wrapper })
  return { qc, result }
}

const read = (qc: QueryClient) => qc.getQueryData<ListItemWithGear[]>(KEY) ?? []
const find = (qc: QueryClient, id: string) => read(qc).find((i) => i.id === id)!
const readFoodIds = (qc: QueryClient) => qc.getQueryData<string[]>(FOOD_KEY) ?? []

beforeEach(() => {
  h.resetPackedForList.mockResolvedValue(undefined)
  h.resetReadyForList.mockResolvedValue(undefined)
  h.resetFoodPackForList.mockResolvedValue(undefined)
})

afterEach(() => vi.clearAllMocks())

describe('useListResetActions', () => {
  describe('resetPacked', () => {
    it('optimistically clears isPacked on every cached item', async () => {
      const { qc, result } = setup([
        item({ id: 'a', isPacked: true }),
        item({ id: 'b', isPacked: false }),
      ])

      await act(async () => { await result.current.resetPacked() })

      expect(read(qc).every((i) => !i.isPacked)).toBe(true)
    })

    it('calls resetPackedForList with the list id', async () => {
      const { result } = setup([item({ id: 'a', isPacked: true })])

      await act(async () => { await result.current.resetPacked() })

      expect(h.resetPackedForList).toHaveBeenCalledWith(LIST_ID)
    })

    it('invalidates the list-items cache in finally', async () => {
      const { qc, result } = setup([item({ id: 'a', isPacked: true })])
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

      await act(async () => { await result.current.resetPacked() })

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: KEY })
    })

    it('on failure restores only isPacked, leaves isReady untouched, toasts, and does not rethrow', async () => {
      h.resetPackedForList.mockRejectedValueOnce(new Error('boom'))
      const { qc, result } = setup([item({ id: 'a', isPacked: true, isReady: true })])

      // Resolves (no rethrow) - the fire-and-forget contract.
      await act(async () => {
        await expect(result.current.resetPacked()).resolves.toBeUndefined()
      })

      const a = find(qc, 'a')
      expect(a.isPacked).toBe(true) // cleared then rolled back
      expect(a.isReady).toBe(true) // never touched by resetPacked
      expect(toast.showToast).toHaveBeenCalledWith(
        "Couldn't reset packed items. Please try again.",
        { type: 'error' },
      )
    })
  })

  describe('resetReady', () => {
    it('optimistically clears isReady on every cached item', async () => {
      const { qc, result } = setup([
        item({ id: 'a', isReady: true }),
        item({ id: 'b', isReady: false }),
      ])

      await act(async () => { await result.current.resetReady() })

      expect(read(qc).every((i) => !i.isReady)).toBe(true)
    })

    it('calls resetReadyForList with the list id', async () => {
      const { result } = setup([item({ id: 'a', isReady: true })])

      await act(async () => { await result.current.resetReady() })

      expect(h.resetReadyForList).toHaveBeenCalledWith(LIST_ID)
    })

    it('on failure restores only isReady, leaves isPacked untouched, toasts, and does not rethrow', async () => {
      h.resetReadyForList.mockRejectedValueOnce(new Error('boom'))
      const { qc, result } = setup([item({ id: 'a', isPacked: true, isReady: true })])

      await act(async () => {
        await expect(result.current.resetReady()).resolves.toBeUndefined()
      })

      const a = find(qc, 'a')
      expect(a.isReady).toBe(true) // cleared then rolled back
      expect(a.isPacked).toBe(true) // never touched by resetReady
      expect(toast.showToast).toHaveBeenCalledWith(
        "Couldn't reset ready checks. Please try again.",
        { type: 'error' },
      )
    })
  })

  describe('resetPacked food side', () => {
    it('with a plan attached, clears the food id cache and calls the food endpoint', async () => {
      const { qc, result } = setup([item({ id: 'a', isPacked: true })], {
        hasFoodPlan: true,
        packedFoodIds: ['f1', 'f2'],
      })

      await act(async () => { await result.current.resetPacked() })

      expect(readFoodIds(qc)).toEqual([])
      expect(h.resetFoodPackForList).toHaveBeenCalledWith(LIST_ID)
      expect(read(qc).every((i) => !i.isPacked)).toBe(true)
    })

    it('without a plan, never touches the food cache or endpoint', async () => {
      const { qc, result } = setup([item({ id: 'a', isPacked: true })], {
        hasFoodPlan: false,
        // A stale cache from a plan attached earlier in the session: the
        // reset must not assume it owns this key when no plan is linked.
        packedFoodIds: ['stale'],
      })

      await act(async () => { await result.current.resetPacked() })

      expect(h.resetFoodPackForList).not.toHaveBeenCalled()
      expect(readFoodIds(qc)).toEqual(['stale'])
    })

    it('food failure rolls back only the food ids; the gear clear survives; one toast', async () => {
      h.resetFoodPackForList.mockRejectedValueOnce(new Error('boom'))
      const { qc, result } = setup([item({ id: 'a', isPacked: true })], {
        hasFoodPlan: true,
        packedFoodIds: ['f1'],
      })

      await act(async () => {
        await expect(result.current.resetPacked()).resolves.toBeUndefined()
      })

      expect(readFoodIds(qc)).toEqual(['f1']) // cleared then rolled back
      expect(find(qc, 'a').isPacked).toBe(false) // gear side committed
      expect(toast.showToast).toHaveBeenCalledTimes(1)
    })

    it('gear failure rolls back only the gear flags; the food clear survives; one toast', async () => {
      h.resetPackedForList.mockRejectedValueOnce(new Error('boom'))
      const { qc, result } = setup([item({ id: 'a', isPacked: true })], {
        hasFoodPlan: true,
        packedFoodIds: ['f1'],
      })

      await act(async () => {
        await expect(result.current.resetPacked()).resolves.toBeUndefined()
      })

      expect(find(qc, 'a').isPacked).toBe(true) // cleared then rolled back
      expect(readFoodIds(qc)).toEqual([]) // food side committed
      expect(toast.showToast).toHaveBeenCalledTimes(1)
    })

    it('invalidates the food-pack cache in finally', async () => {
      const { qc, result } = setup([item({ id: 'a', isPacked: true })], {
        hasFoodPlan: true,
        packedFoodIds: ['f1'],
      })
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

      await act(async () => { await result.current.resetPacked() })

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: FOOD_KEY })
    })
  })

  describe('field-scoped rollback independence', () => {
    it('a failing resetPacked run concurrently with a succeeding resetReady does not stomp the ready clear', async () => {
      h.resetPackedForList.mockRejectedValueOnce(new Error('boom')) // packed fails
      // resetReadyForList resolves (default) - ready clear commits
      const { qc, result } = setup([item({ id: 'a', isPacked: true, isReady: true })])

      await act(async () => {
        await Promise.all([result.current.resetPacked(), result.current.resetReady()])
      })

      const a = find(qc, 'a')
      // packed failed -> its optimistic clear is rolled back to true...
      expect(a.isPacked).toBe(true)
      // ...but resetPacked's whole-row-free rollback never touches isReady, so
      // the concurrent resetReady clear survives.
      expect(a.isReady).toBe(false)
    })
  })
})
