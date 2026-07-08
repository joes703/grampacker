import { afterEach, describe, expect, it, vi } from 'vitest'
import { CSRF_HEADER } from '../../../shared/api'
import {
  bulkDeleteGearItems,
  bulkMoveToCategoryGearItems,
  createGearItem,
  deleteGearItem,
  fetchGearItems,
  reorderGearItems,
  updateGearItem,
} from './gear'
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  renameCategory,
  reorderCategories,
} from './categories'

const GEAR_ROW = {
  id: 'g1',
  categoryId: null,
  name: 'Tent',
  description: null,
  weightGrams: 1250,
  cost: 129.99,
  purchaseDate: '2024-06-15',
  status: 'active',
  sortOrder: 0,
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z',
}

const CATEGORY_ROW = {
  id: 'c1',
  name: 'Shelter',
  sortOrder: 0,
  createdAt: '2026-07-08T00:00:00.000Z',
}

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
    }),
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

// Each case pins the endpoint contract the server tests enforce from the
// other side: URL, method, body shape, and the CSRF header on writes.
describe('gear queries hit the documented endpoints', () => {
  it('fetchGearItems: GET /api/gear-items, validated rows', async () => {
    const fn = mockFetch(200, [GEAR_ROW])
    const rows = await fetchGearItems()
    expect(rows).toEqual([GEAR_ROW])
    expect(requestOf(fn)).toMatchObject({
      url: '/api/gear-items',
      method: 'GET',
      csrf: undefined,
    })
  })

  it('createGearItem: POST /api/gear-items with the input body', async () => {
    const fn = mockFetch(200, GEAR_ROW)
    await createGearItem({ name: 'Tent', weightGrams: 1250 })
    expect(requestOf(fn)).toMatchObject({
      url: '/api/gear-items',
      method: 'POST',
      body: { name: 'Tent', weightGrams: 1250 },
      csrf: '1',
    })
  })

  it('updateGearItem: PATCH with null-to-clear semantics preserved', async () => {
    const fn = mockFetch(200, GEAR_ROW)
    await updateGearItem('g1', { categoryId: null, name: 'Tarp' })
    expect(requestOf(fn)).toMatchObject({
      url: '/api/gear-items/g1',
      method: 'PATCH',
      body: { categoryId: null, name: 'Tarp' },
    })
  })

  it('deleteGearItem: DELETE /api/gear-items/:id', async () => {
    const fn = mockFetch(204)
    await deleteGearItem('g1')
    expect(requestOf(fn)).toMatchObject({
      url: '/api/gear-items/g1',
      method: 'DELETE',
      csrf: '1',
    })
  })

  it('bulk delete/move and reorder hit their endpoints with exact bodies', async () => {
    let fn = mockFetch(204)
    await bulkDeleteGearItems(['a', 'b'])
    expect(requestOf(fn)).toMatchObject({
      url: '/api/gear-items/bulk-delete',
      method: 'POST',
      body: { ids: ['a', 'b'] },
    })

    fn = mockFetch(204)
    await bulkMoveToCategoryGearItems(['a'], null)
    expect(requestOf(fn)).toMatchObject({
      url: '/api/gear-items/bulk-move',
      method: 'POST',
      body: { ids: ['a'], categoryId: null },
    })

    fn = mockFetch(204)
    await reorderGearItems([{ id: 'a', sortOrder: 1 }])
    expect(requestOf(fn)).toMatchObject({
      url: '/api/gear-items/order',
      method: 'PUT',
      body: [{ id: 'a', sortOrder: 1 }],
    })
  })
})

describe('category queries hit the documented endpoints', () => {
  it('fetch/create/rename/delete/reorder', async () => {
    let fn = mockFetch(200, [CATEGORY_ROW])
    expect(await fetchCategories()).toEqual([CATEGORY_ROW])
    expect(requestOf(fn).url).toBe('/api/categories')

    fn = mockFetch(200, CATEGORY_ROW)
    await createCategory('Shelter')
    expect(requestOf(fn)).toMatchObject({
      url: '/api/categories',
      method: 'POST',
      body: { name: 'Shelter' },
    })

    fn = mockFetch(200, CATEGORY_ROW)
    await renameCategory('c1', 'Sleep')
    expect(requestOf(fn)).toMatchObject({
      url: '/api/categories/c1',
      method: 'PATCH',
      body: { name: 'Sleep' },
    })

    fn = mockFetch(204)
    await deleteCategory('c1')
    expect(requestOf(fn)).toMatchObject({
      url: '/api/categories/c1',
      method: 'DELETE',
    })

    fn = mockFetch(204)
    await reorderCategories([{ id: 'c1', sortOrder: 0 }])
    expect(requestOf(fn)).toMatchObject({
      url: '/api/categories/order',
      method: 'PUT',
      body: [{ id: 'c1', sortOrder: 0 }],
    })
  })

  it('a drifted row shape is rejected by the shared schema', async () => {
    mockFetch(200, [{ ...CATEGORY_ROW, sortOrder: 'zero' }])
    await expect(fetchCategories()).rejects.toThrow()
  })
})
