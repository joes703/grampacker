import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  errorHandler,
  recordAuthLog,
  resetLogBudget,
  withAuthErrorCorrelation,
} from './error-handler'
import { isDevEnvironment, securityHeaders } from './security-headers'
import type { AppDeps, AppEnv } from '../env'

// Synthetic handlers read only the dev flag; false selects production headers.
const prodEnv = { dev: false } as AppDeps

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The handler is registered on the ROOT app while the throwing routes live in a
// sub-app, because that topology is the thing being relied on: a sub-app's own
// onError would win, so `api` must not have one. Mirrors server/index.ts.
function appThatThrows(thrown: unknown) {
  const root = new Hono<{ Bindings: AppDeps }>()
  root.use('*', securityHeaders)
  const api = new Hono<{ Bindings: AppDeps }>()
  api.get('/boom', () => {
    throw thrown
  })
  root.route('/api', api)
  root.get('/spa-boom', () => {
    throw thrown
  })
  root.onError(errorHandler)
  return root
}

function logLines(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
  return spy.mock.calls.map(
    (call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>,
  )
}

describe('unhandled server errors', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetLogBudget()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('answers a JSON 500 with a correlation id that matches the logged one', async () => {
    const res = await appThatThrows(new Error('kaboom')).request('/api/boom', {}, prodEnv)
    expect(res.status).toBe(500)

    const body = (await res.json()) as { error: string; correlationId?: string }
    expect(body.error).toBe('Internal Server Error')
    expect(body.correlationId).toMatch(UUID_RE)

    const [entry] = logLines(consoleError)
    expect(entry).toMatchObject({
      event: 'server-error',
      source: 'throw',
      correlationId: body.correlationId,
      method: 'GET',
      path: '/api/boom',
      status: 500,
      message: 'kaboom',
    })
  })

  it('never echoes the thrown message to the client', async () => {
    // Repo throws carry internal detail (`unknown category tempId: ...`).
    const secret = 'unknown category tempId: abc123'
    const res = await appThatThrows(new Error(secret)).request('/api/boom', {}, prodEnv)
    expect(await res.text()).not.toContain(secret)
  })

  it('still carries the full security-header map', async () => {
    const res = await appThatThrows(new Error('kaboom')).request('/api/boom', {}, prodEnv)
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
  })

  // createApp classifies dev-vs-prod once, at startup. An origin that does
  // not parse must select the production header set (fail closed), not throw.
  it('treats a malformed origin as production', () => {
    expect(isDevEnvironment({ BETTER_AUTH_URL: 'not a url' } as AppEnv)).toBe(false)
    expect(isDevEnvironment({ BETTER_AUTH_URL: 'http://localhost:5173' } as AppEnv)).toBe(true)
  })

  it('serves a non-JSON 500 outside /api', async () => {
    const res = await appThatThrows(new Error('kaboom')).request('/spa-boom', {}, prodEnv)
    expect(res.status).toBe(500)
    expect(res.headers.get('Content-Type')).toContain('text/plain')
    expect(await res.text()).toBe('Internal Server Error')
  })
})

describe('HTTPException handling', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetLogBudget()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('passes a deliberate sub-500 through untouched and logs nothing', async () => {
    const thrown = new HTTPException(413, { message: 'Request body too large' })
    const res = await appThatThrows(thrown).request('/api/boom', {}, prodEnv)
    expect(res.status).toBe(413)
    expect(await res.text()).toBe('Request body too large')
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('treats a 5xx HTTPException as an incident and hides its message', async () => {
    // Installed Hono throws exactly this shape when cloning an already-consumed
    // request, and its message names req.json() and bodyCache.
    const internals = 'Cannot clone request: body was already consumed and not cached.'
    const res = await appThatThrows(new HTTPException(500, { message: internals })).request(
      '/api/boom',
      {},
      prodEnv,
    )
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('bodyCache')

    const [entry] = logLines(consoleError)
    expect(entry).toMatchObject({ event: 'server-error', source: 'http-exception', status: 500 })
  })

  it('preserves Retry-After from a deliberate 503', async () => {
    const response = new Response('unavailable', {
      status: 503,
      headers: { 'Retry-After': '120' },
    })
    const res = await appThatThrows(new HTTPException(503, { res: response })).request(
      '/api/boom',
      {},
      prodEnv,
    )
    expect(res.status).toBe(503)
    // The body is replaced (it could carry internals); the one header telling
    // the client when to come back is not collateral damage.
    expect(res.headers.get('Retry-After')).toBe('120')
  })
})

describe('log volume ceiling', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetLogBudget()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('emits at most 21 entries no matter how many errors arrive', async () => {
    const thrower = appThatThrows(new Error('flood'))
    for (let i = 0; i < 500; i += 1) {
      await thrower.request('/api/boom', {}, prodEnv)
    }

    const entries = logLines(consoleError)
    // Exactly 21: 20 detailed plus one line announcing suppression. Asserted as
    // an exact ceiling, not "fewer than before" - a reduction is not a bound.
    expect(entries).toHaveLength(21)
    expect(entries.filter((e) => e.event === 'server-error')).toHaveLength(20)
    expect(entries.filter((e) => e.event === 'server-error-suppressed')).toHaveLength(1)
  })

  it('holds the ceiling when requests race concurrently', async () => {
    // Requests interleave at every await, so the ceiling holds because the
    // claim is synchronous end to end.
    const thrower = appThatThrows(new Error('flood'))
    await Promise.all(
      Array.from({ length: 300 }, () => thrower.request('/api/boom', {}, prodEnv)),
    )
    expect(logLines(consoleError)).toHaveLength(21)
  })

  it('stops handing out correlation ids once logging is suppressed', async () => {
    const thrower = appThatThrows(new Error('flood'))
    let lastBody: { correlationId?: string } = {}
    for (let i = 0; i < 40; i += 1) {
      lastBody = (await (await thrower.request('/api/boom', {}, prodEnv)).json()) as {
        correlationId?: string
      }
    }
    // An id whose log line was suppressed is a promise that cannot be kept.
    expect(lastBody.correlationId).toBeUndefined()
  })

  it('restores the budget once the window rolls over', async () => {
    vi.useFakeTimers()
    try {
      const thrower = appThatThrows(new Error('flood'))
      for (let i = 0; i < 40; i += 1) {
        await thrower.request('/api/boom', {}, prodEnv)
      }
      expect(logLines(consoleError)).toHaveLength(21)

      vi.advanceTimersByTime(60_001)
      const res = await thrower.request('/api/boom', {}, prodEnv)
      const body = (await res.json()) as { correlationId?: string }
      expect(body.correlationId).toMatch(UUID_RE)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('auth 5xx correlation', () => {
  let consoleError: ReturnType<typeof vi.spyOn>
  const req = { method: 'POST', path: '/api/auth/sign-out' }

  beforeEach(() => {
    resetLogBudget()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('leaves sub-500 responses alone', async () => {
    const original = new Response(JSON.stringify({ code: 'BAD_REQUEST' }), { status: 400 })
    const res = await withAuthErrorCorrelation(original, req)
    expect(res).toBe(original)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('synthesizes a body for better-calls empty generic 500', async () => {
    const res = await withAuthErrorCorrelation(new Response(null, { status: 500 }), req)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' })
    expect(body.correlationId).toMatch(UUID_RE)
  })

  it('merges into an APIError body without disturbing it, Set-Cookie included', async () => {
    // better-auth/dist/api/routes/session.mjs:257 throws this shape, and the
    // same route calls deleteSessionCookie - so the teardown cookie rides along.
    const original = new Response(
      JSON.stringify({ message: 'Failed to get session', code: 'FAILED_TO_GET_SESSION' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'better-auth.session_token=; Max-Age=0; Path=/',
        },
      },
    )

    const res = await withAuthErrorCorrelation(original, req)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('FAILED_TO_GET_SESSION')
    expect(body.message).toBe('Failed to get session')
    expect(body.correlationId).toMatch(UUID_RE)
    // Dropping this would leave a dead session cookie in the browser.
    expect(res.headers.get('Set-Cookie')).toBe('better-auth.session_token=; Max-Age=0; Path=/')
    expect(res.status).toBe(500)
  })

  it.each([
    ['malformed JSON', '{not json'],
    ['plain text', 'Internal Server Error'],
    ['a JSON array', '[1,2,3]'],
    ['a JSON string', '"nope"'],
    ['JSON null', 'null'],
  ])('returns %s untouched, byte for byte', async (_label, raw) => {
    // None of these can gain a field without changing shape, so they are handed
    // back exactly as better-auth wrote them rather than guessed at.
    const res = await withAuthErrorCorrelation(new Response(raw, { status: 500 }), req)
    expect(await res.text()).toBe(raw)
  })
})

describe('auth logs share the incident budget', () => {
  let consoleError: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    resetLogBudget()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => consoleError.mockRestore())

  it('counts better-auth log lines against the same ceiling as incidents', async () => {
    // Warnings go to console.warn, but they spend the same budget, and they
    // stay silent once it is spent.
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const thrower = appThatThrows(new Error('flood'))
      for (let i = 0; i < 15; i += 1) await thrower.request('/api/boom', {}, prodEnv)
      for (let i = 0; i < 3; i += 1) recordAuthLog('warn', `auth warning ${i}`)
      for (let i = 0; i < 15; i += 1) recordAuthLog('error', `auth flood ${i}`)
      for (let i = 0; i < 5; i += 1) recordAuthLog('warn', `late warning ${i}`)
      const entries = [...logLines(consoleError), ...logLines(consoleWarn)]
      expect(entries).toHaveLength(21)
      expect(entries.filter((e) => e.event === 'server-error')).toHaveLength(15)
      expect(entries.filter((e) => e.event === 'auth-log')).toHaveLength(5)
      expect(logLines(consoleWarn)).toHaveLength(3)
      expect(entries.filter((e) => e.event === 'server-error-suppressed')).toHaveLength(1)
    } finally {
      consoleWarn.mockRestore()
    }
  })
})
