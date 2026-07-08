import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CSRF_HEADER } from '../../shared/api'
import { ApiError, apiFetch, apiFetchVoid } from './api'

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers:
        body === undefined ? {} : { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

function requestOf(fn: ReturnType<typeof vi.fn>): {
  url: string
  init: RequestInit
} {
  const call = fn.mock.calls[0] as [string, RequestInit] | undefined
  if (!call) throw new Error('fetch was not called')
  return { url: call[0], init: call[1] }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch', () => {
  it('prefixes /api, GETs without the CSRF header, validates the response', async () => {
    const fn = mockFetch(200, [{ id: 'c1' }])
    const rows = await apiFetch('/categories', z.array(z.object({ id: z.string() })))
    expect(rows).toEqual([{ id: 'c1' }])
    const { url, init } = requestOf(fn)
    expect(url).toBe('/api/categories')
    expect(init.method).toBe('GET')
    expect(
      (init.headers as Record<string, string>)[CSRF_HEADER],
    ).toBeUndefined()
  })

  it('unsafe methods always carry the CSRF header and JSON body', async () => {
    const fn = mockFetch(200, { id: 'c1' })
    await apiFetch('/categories', z.object({ id: z.string() }), {
      method: 'POST',
      body: { name: 'Shelter' },
    })
    const { init } = requestOf(fn)
    const headers = init.headers as Record<string, string>
    expect(headers[CSRF_HEADER]).toBe('1')
    expect(headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"name":"Shelter"}')
  })

  it('maps the standard error body to ApiError with status and message', async () => {
    mockFetch(422, { error: 'Gear item limit reached (500 per user)' })
    const err = await apiFetch('/gear-items', z.unknown(), {
      method: 'POST',
      body: { name: 'x' },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(422)
    expect((err as ApiError).message).toBe(
      'Gear item limit reached (500 per user)',
    )
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>gateway</html>', { status: 502 })),
    )
    const err = await apiFetch('/categories', z.unknown()).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toBe('Request failed (502)')
  })

  it('response shape drift fails loudly instead of leaking into the UI', async () => {
    mockFetch(200, [{ wrong: 'shape' }])
    await expect(
      apiFetch('/categories', z.array(z.object({ id: z.string() }))),
    ).rejects.toThrow()
  })
})

describe('apiFetchVoid', () => {
  it('accepts a 204 with no body', async () => {
    const fn = mockFetch(204)
    await expect(
      apiFetchVoid('/gear-items/order', { method: 'PUT', body: [] }),
    ).resolves.toBeUndefined()
    expect(
      (requestOf(fn).init.headers as Record<string, string>)[CSRF_HEADER],
    ).toBe('1')
  })

  it('still surfaces errors as ApiError', async () => {
    mockFetch(404, { error: 'Not found' })
    const err = await apiFetchVoid('/categories/nope', {
      method: 'DELETE',
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
  })
})
