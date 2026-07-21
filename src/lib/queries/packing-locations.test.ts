import { afterEach, describe, expect, it, vi } from 'vitest'
import { CSRF_HEADER } from '../../../shared/api'
import { createPackingLocation } from './packing-locations'

const LOCATION = {
  id: 'loc-1',
  name: 'Bear canister',
  sortOrder: 0,
  containerListItemId: 'item-canister',
}

function mockFetch() {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(LOCATION), { status: 201 }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

function requestOf(fn: ReturnType<typeof vi.fn>) {
  const call = fn.mock.calls[0] as [string, RequestInit] | undefined
  if (!call) throw new Error('fetch was not called')
  const [url, init] = call
  return {
    url,
    method: init.method,
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    csrf: (init.headers as Record<string, string>)[CSRF_HEADER],
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('createPackingLocation', () => {
  it.each([
    [{ name: 'Side pocket' }, { name: 'Side pocket' }],
    [
      { containerListItemId: 'item-canister' },
      { containerListItemId: 'item-canister' },
    ],
  ] as const)('posts the exact location variant %#', async (input, body) => {
    const fetch = mockFetch()

    await createPackingLocation('list-1', input)

    expect(requestOf(fetch)).toEqual({
      url: '/api/lists/list-1/packing-locations',
      method: 'POST',
      body,
      csrf: '1',
    })
  })
})
