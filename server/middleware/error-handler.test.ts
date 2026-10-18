import { env } from '../test/node-env'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { sql } from 'drizzle-orm'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { createDb } from '../db'
import {
  errorHandler,
  resetLogBudget,
} from './error-handler'
import { securityHeaders } from './security-headers'
import type { AppEnv } from '../env'

// Prod-like origin so securityHeaders emits the full set (the test default is
// localhost = dev mode, which omits the CSP).
const prodEnv = { ...env, BETTER_AUTH_URL: 'https://grampacker.app' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The handler is registered on the ROOT app while the throwing routes live in a
// sub-app, because that topology is the thing being relied on: a sub-app's own
// onError would win, so `api` must not have one. Mirrors server/index.ts.
function appThatThrows(thrown: unknown) {
  const root = new Hono<{ Bindings: AppEnv }>()
  root.use('*', securityHeaders)
  const api = new Hono<{ Bindings: AppEnv }>()
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

describe('the real app', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetLogBudget()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('routes a genuine route failure through the handler', async () => {
    // Not a synthetic throw: /api/health round-trips through Drizzle to the
    // database, so removing the connection fails the way a real outage would - and
    // proves the handler is actually wired to the exported app.
    const res = await app.request('/api/health', {}, { ...prodEnv, DB: undefined })
    expect(res.status).toBe(500)

    const body = (await res.json()) as { error: string; correlationId?: string }
    expect(body.error).toBe('Internal Server Error')
    expect(body.correlationId).toMatch(UUID_RE)
    expect(logLines(consoleError)[0]).toMatchObject({
      event: 'server-error',
      path: '/api/health',
    })
  })
})

describe('bound parameters never reach the log', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetLogBudget()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('logs a REAL Drizzle failure with its diagnosis and without its params', async () => {
    // Not a hand-built error: a statement that fails on SQLite with a bound
    // sentinel, wrapped by the installed drizzle-orm exactly as a repo failure
    // would be. On better-sqlite3 Drizzle's wrapper names the SQL with `?`
    // placeholders and never the values, so this pins that the real failure
    // shape keeps its diagnosis and carries no params into the log. The next
    // test covers the wrapper shape that DOES embed params.
    const sentinel = 'bound-value-that-must-never-be-logged-7a3d'
    let thrown: unknown
    try {
      await createDb(env.DB).run(sql`select 1 from no_such_table where x = ${sentinel}`)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)

    const res = await appThatThrows(thrown).request('/api/boom', {}, prodEnv)
    expect(res.status).toBe(500)

    const everything = consoleError.mock.calls.flat().map(String).join('\n')
    expect(everything).not.toContain(sentinel)
    // The parts that diagnose the failure survive: the statement and the
    // SQLite text on the cause chain.
    expect(everything).toContain('no_such_table')
    expect(everything).toContain('no such table')
    const [entry] = logLines(consoleError)
    expect(entry).toMatchObject({ event: 'server-error', status: 500 })
    expect(entry!.cause).toBeDefined()
  })

  it('redacts the params of Drizzle\'s DrizzleQueryError and keeps the diagnosis', async () => {
    // DrizzleQueryError is the wrapper whose message is
    // `Failed query: <sql>\nparams: <every bound value>`. Drizzle's other
    // drivers throw it for every failed statement, and better-auth's session
    // lookup failure carries the session token this way. Built with Drizzle's
    // own class around a real SQLite failure, and the leak is proven present
    // first, so the assertion below cannot pass because it was never there.
    const sentinel = 'bound-value-that-must-never-be-logged-9c1e'
    let root: unknown
    try {
      env.DB.prepare('select 1 from no_such_table where x = ?').get(sentinel)
    } catch (err) {
      root = err
    }
    const thrown = new DrizzleQueryError(
      'select 1 from no_such_table where x = ?',
      [sentinel],
      root as Error,
    )
    expect(thrown.message).toContain(sentinel)

    const res = await appThatThrows(thrown).request('/api/boom', {}, prodEnv)
    expect(res.status).toBe(500)

    const everything = consoleError.mock.calls.flat().map(String).join('\n')
    expect(everything).not.toContain(sentinel)
    expect(everything).toContain('no_such_table')
    expect(everything).toContain('no such table')
  })
})
