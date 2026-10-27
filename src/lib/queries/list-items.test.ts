import { afterEach, describe, expect, it, vi } from 'vitest'
import { CSRF_HEADER } from '../../../shared/api'
import {
  addListItem,
  deleteListItem,
  fetchListItems,
  quickAddListItem,
  reorderListItems,
  reorderPackListItems,
  resetPackedForList,
  resetReadyForList,
  updateListItem,
} from './list-items'

// URL/method contract tests (review P2.2). The two reorder endpoints are the
// headline case: /items/order writes DOCUMENT order and /items/pack-order
// writes PACK order, one path segment apart - swapping them would corrupt
// the other view's ordering while every mocked-out component test stayed
// green.

const GEAR_ROW = {
  id: 'g1',
  categoryId: null,
  name: 'Tent',
  description: null,
  weightGrams: 900,
  cost: null,
  purchaseDate: null,
  status: 'active',
  sortOrder: 0,
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z',
}

const ITEM_ROW = {
  id: 'li1',
  listId: 'l1',
  gearItemId: 'g1',
  quantity: 1,
  isWorn: false,
  isConsumable: false,
  isPacked: false,
  isReady: false,
  packingLocationId: null,
  sortOrder: 0,
  packSortOrder: 0,
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z',
  gearItem: GEAR_ROW,
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

describe('list-item queries hit the documented endpoints', () => {
  it('fetchListItems: GET /api/lists/:id/items', async () => {
    const fn = mockFetch(200, [ITEM_ROW])
    expect(await fetchListItems('l1')).toEqual([ITEM_ROW])
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/items',
      method: 'GET',
      csrf: undefined,
    })
  })

  it('addListItem: POST /api/lists/:id/items with the gear id', async () => {
    const fn = mockFetch(200, ITEM_ROW)
    await addListItem('l1', 'g1')
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/items',
      method: 'POST',
      body: { gearItemId: 'g1' },
      csrf: '1',
    })
  })

  it('quickAddListItem: POST /api/lists/:id/items/quick-add', async () => {
    const fn = mockFetch(200, ITEM_ROW)
    await quickAddListItem('l1', { name: 'Spork', weightGrams: 12 })
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/items/quick-add',
      method: 'POST',
      body: { name: 'Spork', weightGrams: 12 },
      csrf: '1',
    })
  })

  it('updateListItem: PATCH /api/lists/:id/items/:itemId', async () => {
    const fn = mockFetch(200, ITEM_ROW)
    await updateListItem('l1', 'li1', { packingLocationId: null })
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/items/li1',
      method: 'PATCH',
      body: { packingLocationId: null },
      csrf: '1',
    })
  })

  it('deleteListItem: DELETE /api/lists/:id/items/:itemId', async () => {
    const fn = mockFetch(204)
    await deleteListItem('l1', 'li1')
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/items/li1',
      method: 'DELETE',
      csrf: '1',
    })
  })

  it('reorderListItems: PUT /api/lists/:id/items/order - DOCUMENT order', async () => {
    const fn = mockFetch(204)
    await reorderListItems('l1', [{ id: 'li1', sortOrder: 3 }])
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/items/order',
      method: 'PUT',
      body: [{ id: 'li1', sortOrder: 3 }],
      csrf: '1',
    })
  })

  it('reorderPackListItems: PUT /api/lists/:id/items/pack-order - PACK order', async () => {
    const fn = mockFetch(204)
    await reorderPackListItems('l1', { items: [{ id: 'li1', packSortOrder: 3 }], foodItems: [] })
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/items/pack-order',
      method: 'PUT',
      body: { items: [{ id: 'li1', packSortOrder: 3 }], foodItems: [] },
      csrf: '1',
    })
  })

  it('resetPackedForList: POST /api/lists/:id/items/reset-packed', async () => {
    const fn = mockFetch(204)
    await resetPackedForList('l1')
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/items/reset-packed',
      method: 'POST',
      csrf: '1',
    })
  })

  it('resetReadyForList: POST /api/lists/:id/items/reset-ready', async () => {
    const fn = mockFetch(204)
    await resetReadyForList('l1')
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/items/reset-ready',
      method: 'POST',
      csrf: '1',
    })
  })
})
