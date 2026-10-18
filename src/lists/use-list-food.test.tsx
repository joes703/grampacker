// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import type { FoodItemResponse, ListFoodResponse } from '../../shared/food'
import {
  clearToasts,
  deferred,
  renderHookWithClient,
  shownToasts,
  testQueryClient,
} from '../test/mutation-hook-harness'

// The food rows' two writes: the Packed/Ready checkboxes and the move between
// packing locations. Both roll back only the fields they wrote, onto the row
// as it is NOW. A whole-row or whole-cache rollback would erase another
// write that succeeded while this one was in flight. The settle refetch
// repairs it only if it returns: the next write cancels it, and offline it
// never runs. Only the network functions are mocked; the cache and the
// toast store are real.

const LIST_ID = 'list-1'

const h = vi.hoisted(() => ({
  fetchListFood: vi.fn<(listId: string) => Promise<unknown>>(),
  updateFoodItem: vi.fn<(listId: string, foodId: string, patch: unknown) => Promise<void>>(),
}))

vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  fetchListFood: h.fetchListFood,
}))
vi.mock('../lib/queries/food', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries/food')>()),
  updateFoodItem: h.updateFoodItem,
}))

import { useListFood } from './use-list-food'

function food(over: Partial<FoodItemResponse> = {}): FoodItemResponse {
  return {
    id: 'f1', name: 'Tortillas', weightGrams: 50, quantity: 1, isPerMeal: true,
    unitCount: 1, sortOrder: 0, isPacked: false, isReady: false,
    packingLocationId: null, packSortOrder: 0, slotIds: [], ...over,
  }
}

const key = ['list-food', LIST_ID] as const

// Seeds the cache, then renders the hook. The hook's own fetch never answers,
// so the cache holds only what the test and the mutations write: a refetch
// cannot quietly repair a bad rollback.
function setup(items: FoodItemResponse[]) {
  const qc = testQueryClient()
  qc.setQueryData<ListFoodResponse>(key, { dayCount: 1, slots: [], items })
  return { qc, result: renderHookWithClient(qc, () => useListFood(LIST_ID)) }
}

const row = (qc: QueryClient, id: string) =>
  qc.getQueryData<ListFoodResponse>(key)!.items.find((item) => item.id === id)!

beforeEach(() => {
  h.fetchListFood.mockReturnValue(new Promise(() => {}))
})

afterEach(() => {
  vi.clearAllMocks()
  clearToasts()
})

describe('useListFood', () => {
  it('a failed Packed tick rewinds only isPacked: a Ready tick on the same row that succeeded mid-flight survives', async () => {
    const packed = deferred()
    h.updateFoodItem
      .mockReturnValueOnce(packed.promise)
      .mockResolvedValueOnce(undefined)
    const { qc, result } = setup([food({ id: 'f1' })])

    await act(async () => {
      result.current.patchPackState.mutate({ foodId: 'f1', patch: { isPacked: true } })
    })
    await act(async () => {
      await result.current.patchPackState.mutateAsync({ foodId: 'f1', patch: { isReady: true } })
    })
    expect(row(qc, 'f1')).toMatchObject({ isPacked: true, isReady: true })

    await act(async () => {
      packed.reject(new Error('network'))
    })
    await waitFor(() => expect(h.updateFoodItem).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(row(qc, 'f1').isPacked).toBe(false))

    expect(row(qc, 'f1').isReady).toBe(true)
    expect(h.updateFoodItem).toHaveBeenNthCalledWith(1, LIST_ID, 'f1', { isPacked: true })
  })

  it("a failed move rewinds only the moved row's placement and says so: Packed ticks saved mid-flight survive, on that row and another", async () => {
    const move = deferred()
    h.updateFoodItem
      .mockReturnValueOnce(move.promise)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
    const { qc, result } = setup([
      food({ id: 'f1', packingLocationId: 'pocket', packSortOrder: 2 }),
      food({ id: 'f2', packSortOrder: 1 }),
    ])

    await act(async () => {
      result.current.moveFood.mutate({ foodId: 'f1', locationId: 'bag', nextPackSortOrder: 9 })
    })
    expect(row(qc, 'f1')).toMatchObject({ packingLocationId: 'bag', packSortOrder: 9 })
    await act(async () => {
      await result.current.patchPackState.mutateAsync({ foodId: 'f2', patch: { isPacked: true } })
      await result.current.patchPackState.mutateAsync({ foodId: 'f1', patch: { isPacked: true } })
    })

    await act(async () => {
      move.reject(new Error('network'))
    })
    await waitFor(() => expect(row(qc, 'f1').packingLocationId).toBe('pocket'))

    expect(row(qc, 'f1')).toMatchObject({ packSortOrder: 2, isPacked: true })
    expect(row(qc, 'f2').isPacked).toBe(true)
    expect(h.updateFoodItem).toHaveBeenNthCalledWith(1, LIST_ID, 'f1', { packingLocationId: 'bag' })
    // A drag that silently snaps back looks like the user dragged it back.
    expect(shownToasts()).toEqual([
      { message: "Couldn't move that item. Please try again.", type: 'error' },
    ])
  })
})
