// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { ListItemWithGear } from '../lib/types'
import type { FoodItemResponse, ListFoodResponse } from '../../shared/food'

// Coverage for resetPacked / resetReady and their field-scoped optimistic
// rollback. The subtle part is that each reset only restores its OWN field on
// failure, so a failing reset never stomps the other reset's clear. We drive
// the hook with a REAL QueryClient (seeded via setQueryData) and mock only the
// fetch helpers + toast, because the cache
// cancel/snapshot/clear/rollback/invalidate lifecycle IS the contract here,
// not an implementation detail to stub out.

const LIST_ID = 'list-1'
const KEY = ['list-items', LIST_ID] as const
const FOOD_KEY = ['list-food', LIST_ID] as const

const h = vi.hoisted(() => ({
  queryKeys: {
    listItems: (id: string) => ['list-items', id] as const,
    listFood: (id: string) => ['list-food', id] as const,
  },
  resetPackedForList: vi.fn<(listId: string) => Promise<void>>(),
  resetReadyForList: vi.fn<(listId: string) => Promise<void>>(),
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
    packingLocationId: null,
    sortOrder: 0, packSortOrder: 0, createdAt: now, updatedAt: now, ...over,
  }
}

function foodItem(over: Partial<FoodItemResponse> = {}): FoodItemResponse {
  return {
    id: 'f1', name: 'Tortillas', weightGrams: 50, quantity: 1, isPerMeal: true,
    unitCount: 1, sortOrder: 0, isPacked: false, isReady: false,
    packingLocationId: null, packSortOrder: 0, slotIds: [], ...over,
  }
}

function setup(items: ListItemWithGear[], food: FoodItemResponse[] = []) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  qc.setQueryData<ListItemWithGear[]>(KEY, items)
  qc.setQueryData<ListFoodResponse>(FOOD_KEY, { dayCount: 1, slots: [], items: food })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(
    () => useListResetActions(LIST_ID),
    { wrapper },
  )
  return { qc, result }
}

const read = (qc: QueryClient) => qc.getQueryData<ListItemWithGear[]>(KEY) ?? []
const find = (qc: QueryClient, id: string) => read(qc).find((i) => i.id === id)!
const findFood = (qc: QueryClient, id: string) => {
  const row = qc.getQueryData<ListFoodResponse>(FOOD_KEY)?.items.find((i) => i.id === id)
  if (!row) throw new Error(`no food row ${id} in the cache`)
  return row
}

beforeEach(() => {
  h.resetPackedForList.mockResolvedValue(undefined)
  h.resetReadyForList.mockResolvedValue(undefined)
})

afterEach(() => vi.clearAllMocks())

describe('useListResetActions', () => {
  describe('resetPacked', () => {
    it('optimistically clears isPacked on every cached item', async () => {
      // Held pending, so the check runs while the request is in flight:
      // "optimistic" means cleared before the server answers.
      let finish: () => void = () => {}
      h.resetPackedForList.mockImplementationOnce(
        () => new Promise<void>((resolve) => { finish = resolve }),
      )
      const { qc, result } = setup([
        item({ id: 'a', isPacked: true }),
        item({ id: 'b', isPacked: false }),
      ])

      let done: Promise<void> = Promise.resolve()
      act(() => { done = result.current.resetPacked() })
      await waitFor(() => expect(h.resetPackedForList).toHaveBeenCalled())

      expect(read(qc).every((i) => !i.isPacked)).toBe(true)

      finish()
      await act(async () => { await done })
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
      let finish: () => void = () => {}
      h.resetReadyForList.mockImplementationOnce(
        () => new Promise<void>((resolve) => { finish = resolve }),
      )
      const { qc, result } = setup([
        item({ id: 'a', isReady: true }),
        item({ id: 'b', isReady: false }),
      ])

      let done: Promise<void> = Promise.resolve()
      act(() => { done = result.current.resetReady() })
      await waitFor(() => expect(h.resetReadyForList).toHaveBeenCalled())

      expect(read(qc).every((i) => !i.isReady)).toBe(true)

      finish()
      await act(async () => { await done })
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

  // The server clears gear and food in one batch, so the cache must too: a
  // reset that left the food checkboxes ticked would contradict the server,
  // and a failed one must put back exactly the food ticks it cleared.
  describe.each([
    { action: 'resetPacked', flag: 'isPacked', other: 'isReady', server: h.resetPackedForList },
    { action: 'resetReady', flag: 'isReady', other: 'isPacked', server: h.resetReadyForList },
  ] as const)('$action on food', ({ action, flag, other, server }) => {
    it(`clears ${flag} on every food row while the request is in flight`, async () => {
      let finish: () => void = () => {}
      server.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
      const { qc, result } = setup([], [
        foodItem({ id: 'f1', [flag]: true, [other]: true }),
        foodItem({ id: 'f2', [flag]: true }),
      ])
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

      let done: Promise<void> = Promise.resolve()
      act(() => { done = result.current[action]() })
      await waitFor(() => expect(server).toHaveBeenCalled())

      expect(findFood(qc, 'f1')).toMatchObject({ [flag]: false, [other]: true })
      expect(findFood(qc, 'f2')[flag]).toBe(false)

      finish()
      await act(async () => { await done })
      // The refetch is what brings the food rows in line with the server.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: FOOD_KEY })
    })

    it(`on failure puts back ${flag} only on the food rows it cleared`, async () => {
      server.mockRejectedValueOnce(new Error('boom'))
      const { qc, result } = setup([], [
        foodItem({ id: 'f1', [flag]: true, [other]: true }),
        foodItem({ id: 'f2', [flag]: false }),
      ])

      await act(async () => { await result.current[action]() })

      expect(findFood(qc, 'f1')).toMatchObject({ [flag]: true, [other]: true })
      expect(findFood(qc, 'f2')[flag]).toBe(false)
    })
  })
})
