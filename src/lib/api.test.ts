import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CSRF_HEADER } from '../../shared/api'
import { ApiError, apiFetch, apiFetchVoid, shouldRetryQuery } from './api'
import { revalidateSessionAfterUnauthorized } from './session-revalidation'

// Mocked here on purpose: this file's subject is what rawFetch DECIDES, and the real
// helper reaches into better-auth's session atom. That the helper actually drives
// better-auth is a separate claim, proved against the real client in
// session-revalidation.test.ts.
vi.mock('./session-revalidation', () => ({
  revalidateSessionAfterUnauthorized: vi.fn(),
}))

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

beforeEach(() => {
  vi.mocked(revalidateSessionAfterUnauthorized).mockClear()
})

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

  it('carries the correlation id off a 500 so the client log can join the server one', async () => {
    mockFetch(500, {
      error: 'Internal Server Error',
      correlationId: 'c0ffee00-dead-4bee-8888-feedfacecafe',
    })
    const err = await apiFetch('/lists', z.unknown()).catch((e: unknown) => e)
    expect((err as ApiError).correlationId).toBe('c0ffee00-dead-4bee-8888-feedfacecafe')
  })

  it('leaves correlationId undefined when the server minted none', async () => {
    // Handler-returned 4xx are not incidents, and the server also stops minting
    // ids once its log budget is spent - so absent is a normal case, not a bug.
    mockFetch(409, { error: 'Conflict' })
    const err = await apiFetch('/lists', z.unknown()).catch((e: unknown) => e)
    expect((err as ApiError).correlationId).toBeUndefined()
  })

  it('response shape drift fails loudly instead of leaking into the UI', async () => {
    mockFetch(200, [{ wrong: 'shape' }])
    await expect(
      apiFetch('/categories', z.array(z.object({ id: z.string() }))),
    ).rejects.toThrow()
  })
})

describe('the 401 policy', () => {
  // One rule, in one place: a 401 from an app-owned route means the session is gone,
  // so ask the server rather than carrying on with authenticated chrome up. The
  // teardown that follows is SessionCacheGuard's, not this module's.

  it('asks better-auth to re-check the session, and still throws ApiError(401)', async () => {
    mockFetch(401, { error: 'Unauthorized' })
    const err = await apiFetch('/lists', z.unknown()).catch((e: unknown) => e)
    expect(revalidateSessionAfterUnauthorized).toHaveBeenCalledTimes(1)
    // Additive: call sites keep whatever error handling they already had.
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
  })

  it.each([403, 404, 409, 422, 500])(
    'leaves the session alone on %i',
    async (status) => {
      mockFetch(status, { error: 'nope' })
      await apiFetch('/lists', z.unknown()).catch(() => {})
      expect(revalidateSessionAfterUnauthorized).not.toHaveBeenCalled()
    },
  )

  it('does not re-check when the request never reached the server', async () => {
    // A network failure says nothing about the session, and treating it as a signal
    // would put every offline blip on a path towards a teardown.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await apiFetch('/lists', z.unknown()).catch(() => {})
    expect(revalidateSessionAfterUnauthorized).not.toHaveBeenCalled()
  })

  it('re-checks on a 401 whose body is not JSON', async () => {
    // Status decides, not the body. A 401 from an edge/proxy carries HTML.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>login</html>', { status: 401 })),
    )
    await apiFetch('/lists', z.unknown()).catch(() => {})
    expect(revalidateSessionAfterUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('re-checks before reading the body, so a stalled body cannot swallow the signal', async () => {
    // rawFetch awaits res.json() to build the error message. If the re-check sat
    // after that await, a truncated or hanging response would mean the one signal
    // that gets the user out of a dead session never fires.
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const neverEnds = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(neverEnds, { status: 401 })),
    )

    const pending = apiFetch('/lists', z.unknown()).catch((e: unknown) => e)
    await vi.waitFor(() =>
      expect(revalidateSessionAfterUnauthorized).toHaveBeenCalledTimes(1),
    )

    // Let the response finish so the test does not leave a promise hanging.
    controller?.close()
    expect(await pending).toBeInstanceOf(ApiError)
  })
})

describe('shouldRetryQuery', () => {
  it('does not retry a 401', () => {
    // The same absent cookie asks the same question; the retry only produces a second
    // 401, which is a second reason to re-check a session already being re-checked.
    expect(shouldRetryQuery(0, new ApiError(401, 'Unauthorized'))).toBe(false)
  })

  it.each([
    [0, 500, true],
    [1, 500, false],
    [0, 404, true],
  ])('retry #%i on %i -> %s', (failureCount, status, expected) => {
    expect(shouldRetryQuery(failureCount, new ApiError(status, 'x'))).toBe(expected)
  })

  it('keeps the single retry for non-ApiError failures', () => {
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldRetryQuery(1, new TypeError('Failed to fetch'))).toBe(false)
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
