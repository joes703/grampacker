import { afterEach, describe, expect, it, vi } from 'vitest'
import { CSRF_HEADER } from '../../../shared/api'
import {
  createList,
  createListFromSelection,
  deleteList,
  duplicateList,
  fetchLists,
  fetchSharedList,
  importListFromCsv,
  reorderLists,
  rotateShareLink,
  updateList,
} from './lists'

// URL/method contract tests: every component and hook test mocks these
// functions away, so only this file sees a wrong path or verb. Same style as
// gear.test.ts:
// stub global fetch, pin URL, method, CSRF header on writes, and body.

const LIST_ROW = {
  id: 'l1',
  name: 'Trip',
  description: null,
  slug: 'abc123',
  isShared: false,
  isDraft: false,
  sortOrder: 0,
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z',
}

const SHARED_ROW = {
  list: { name: 'Trip', description: null, isDraft: false },
  categories: [],
  items: [],
  food: { items: [] },
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

describe('list queries hit the documented endpoints', () => {
  it('fetchLists: GET /api/lists', async () => {
    const fn = mockFetch(200, [LIST_ROW])
    expect(await fetchLists()).toEqual([LIST_ROW])
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists',
      method: 'GET',
      csrf: undefined,
    })
  })

  it('createList: POST /api/lists with the name', async () => {
    const fn = mockFetch(200, LIST_ROW)
    await createList('Trip')
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists',
      method: 'POST',
      body: { name: 'Trip' },
      csrf: '1',
    })
  })

  it('updateList: PATCH /api/lists/:id with the patch verbatim', async () => {
    const fn = mockFetch(200, LIST_ROW)
    await updateList('l1', { isShared: true })
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1',
      method: 'PATCH',
      body: { isShared: true },
      csrf: '1',
    })
  })

  it('deleteList: DELETE /api/lists/:id', async () => {
    const fn = mockFetch(204)
    await deleteList('l1')
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1',
      method: 'DELETE',
      csrf: '1',
    })
  })

  it('reorderLists: PUT /api/lists/order with the updates array', async () => {
    const fn = mockFetch(204)
    await reorderLists([{ id: 'l1', sortOrder: 0 }])
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/order',
      method: 'PUT',
      body: [{ id: 'l1', sortOrder: 0 }],
      csrf: '1',
    })
  })

  it('rotateShareLink: POST /api/lists/:id/share-link with NO body', async () => {
    const fn = mockFetch(200, LIST_ROW)
    await rotateShareLink('l1')
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/share-link',
      method: 'POST',
      body: undefined,
      csrf: '1',
    })
  })

  it('duplicateList: POST /api/lists/:id/duplicate', async () => {
    const fn = mockFetch(200, LIST_ROW)
    await duplicateList('l1')
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/l1/duplicate',
      method: 'POST',
      csrf: '1',
    })
  })

  it('createListFromSelection: POST /api/lists/from-selection', async () => {
    const fn = mockFetch(200, LIST_ROW)
    await createListFromSelection({
      name: 'From gear',
      description: null,
      gearItemIds: ['g1'],
    })
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/from-selection',
      method: 'POST',
      body: { name: 'From gear', description: null, gearItemIds: ['g1'] },
      csrf: '1',
    })
  })

  it('importListFromCsv: POST /api/lists/import', async () => {
    const fn = mockFetch(200, LIST_ROW)
    const input = {
      name: 'Imported',
      categories: [],
      gear: [],
      items: [
        {
          gear: { kind: 'existing' as const, id: 'g1' },
          quantity: 1,
          isWorn: false,
          isConsumable: false,
          sortOrder: 0,
        },
      ],
    }
    await importListFromCsv(input)
    expect(requestOf(fn)).toMatchObject({
      url: '/api/lists/import',
      method: 'POST',
      body: input,
      csrf: '1',
    })
  })

  it('fetchSharedList: GET /api/shares/v2/:slug, 404 maps to null, other errors reject', async () => {
    const fn = mockFetch(200, SHARED_ROW)
    expect(await fetchSharedList('abc123')).toEqual(SHARED_ROW)
    expect(requestOf(fn)).toMatchObject({
      url: '/api/shares/v2/abc123',
      method: 'GET',
      csrf: undefined,
    })

    mockFetch(404, { error: 'Not found' })
    expect(await fetchSharedList('zzzzzz')).toBeNull()

    // An outage must not read as "not found": the share page shows a
    // different message for each.
    mockFetch(500, { error: 'Internal error' })
    await expect(fetchSharedList('abc123')).rejects.toMatchObject({ status: 500 })
  })
})
