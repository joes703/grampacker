import { afterEach, describe, expect, it, vi } from 'vitest'
import { CSRF_HEADER } from '../../../shared/api'
import {
  createFoodItem,
  deleteFoodItem,
  fetchListFood,
  setFoodDays,
  setFoodSlotNeeded,
  updateFoodItem,
} from './food'

// URL/method contract tests (review P2.2), same style as gear.test.ts.

const FOOD_ITEM_ROW = {
  id: 'f1',
  name: 'Oats',
  weightGrams: 90,
  quantity: 1,
  sortOrder: 0,
  slotIds: ['s1'],
}

const LIST_FOOD_ROW = {
  dayCount: 1,
  slots: [{ id: 's1', dayNumber: 1, meal: 'breakfast', needed: true }],
  items: [FOOD_ITEM_ROW],
}

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

function requestOf(fn: ReturnType<typeof vi.fn>): {
  url: string
  method: string
  body: unknown
  csrf: string | undefined
} {
  const call = fn.mock.calls[0] as [string, RequestInit] | undefined
  if (!call) throw new Error('fetch was not called')
  const [url, init] = call
  return {
    url,
    method: init.method ?? 'GET',
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    csrf: (init.headers as Record<string, string>)[CSRF_HEADER],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('food queries hit the documented endpoints', () => {
  it('fetchListFood: GET /api/lists/:id/food', async () => {
    const fn = mockFetch(200, LIST_FOOD_ROW)
    expect(await fetchListFood('l1')).toEqual(LIST_FOOD_ROW)
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/food',
      method: 'GET',
      csrf: undefined,
    })
  })

  it('setFoodDays: PUT /api/lists/:id/food/days', async () => {
    const fn = mockFetch(200, LIST_FOOD_ROW)
    await setFoodDays('l1', 3)
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/food/days',
      method: 'PUT',
      body: { days: 3 },
      csrf: '1',
    })
  })

  it('setFoodSlotNeeded: PATCH /api/lists/:id/food/slots/:slotId', async () => {
    const fn = mockFetch(200, LIST_FOOD_ROW)
    await setFoodSlotNeeded('l1', 's1', false)
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/food/slots/s1',
      method: 'PATCH',
      body: { needed: false },
      csrf: '1',
    })
  })

  it('createFoodItem: POST /api/lists/:id/food/items', async () => {
    const fn = mockFetch(200, FOOD_ITEM_ROW)
    await createFoodItem('l1', {
      name: 'Oats',
      weightGrams: 90,
      quantity: 1,
      slotIds: ['s1'],
    })
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/food/items',
      method: 'POST',
      body: { name: 'Oats', weightGrams: 90, quantity: 1, slotIds: ['s1'] },
      csrf: '1',
    })
  })

  it('updateFoodItem: PATCH /api/lists/:id/food/items/:itemId', async () => {
    const fn = mockFetch(200, FOOD_ITEM_ROW)
    await updateFoodItem('l1', 'f1', { slotIds: [] })
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/food/items/f1',
      method: 'PATCH',
      body: { slotIds: [] },
      csrf: '1',
    })
  })

  it('deleteFoodItem: DELETE /api/lists/:id/food/items/:itemId', async () => {
    const fn = mockFetch(204)
    await deleteFoodItem('l1', 'f1')
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/food/items/f1',
      method: 'DELETE',
      csrf: '1',
    })
  })
})
