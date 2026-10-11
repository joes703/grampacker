import { request as httpRequest } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { env } from './test/node-env'
import { openSqlite } from './db'
import { applyMigrations } from './db/migrate'
import { main, shutdownOnSignals, startServer, type RunningServer } from './node'

// The Node entry over real HTTP: a real listening socket, the real app, and a
// real migrated SQLite database (server/test/node-env.ts). app.request() tests
// elsewhere skip the socket; these prove the process actually serves.

let running: RunningServer
let base: string

beforeAll(async () => {
  running = await startServer(env, { port: 0, hostname: '127.0.0.1' })
  base = `http://127.0.0.1:${running.port}`
})

afterAll(async () => {
  await running.close()
})

describe('the Node server', () => {
  it('answers health with 200 and a body whose ok is exactly true', async () => {
    const res = await fetch(`${base}/api/health`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"ok":true}')
  })

  it('serves the SPA shell, deep links, and hashed assets', async () => {
    const shell = await fetch(`${base}/`)
    expect(shell.status).toBe(200)
    expect(shell.headers.get('content-type')).toContain('text/html')
    // The security-header middleware covers static responses too.
    expect(shell.headers.get('x-frame-options')).toBe('DENY')

    const deepLink = await fetch(`${base}/lists/some-list-id`)
    expect(deepLink.status).toBe(200)
    expect(deepLink.headers.get('content-type')).toContain('text/html')

    const asset = await fetch(`${base}/assets/index-BuiCutTI.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('javascript')
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it('routes the API: CSRF before auth, auth before data, JSON 404s', async () => {
    const anonymousRead = await fetch(`${base}/api/categories`)
    expect(anonymousRead.status).toBe(401)

    const noCsrfHeader = await fetch(`${base}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(noCsrfHeader.status).toBe(403)

    const unknown = await fetch(`${base}/api/no-such-route`)
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: 'Not found' })
  })
})

describe('health reaches SQLite', () => {
  it('is not healthy when the database cannot answer', async () => {
    const broken = openSqlite(':memory:')
    broken.close()
    const server = await startServer({ ...env, DB: broken }, { port: 0, hostname: '127.0.0.1' })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/health`)
      expect(res.status).toBe(500)
      expect(await res.text()).not.toContain('"ok":true')
    } finally {
      await server.close()
    }
  })
})

describe('graceful close', () => {
  it('refuses new connections but lets an in-flight request finish', async () => {
    const server = await startServer(env, { port: 0, hostname: '127.0.0.1' })
    const body = JSON.stringify({ email: 'graceful-close@example.com' })

    // A magic-link send whose body arrives in two halves: the request is
    // in flight, waiting for the rest of its body, when close() begins.
    const response = new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: server.port,
          method: 'POST',
          path: '/api/auth/sign-in/magic-link',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'x-real-ip': '198.51.100.40',
          },
        },
        (res) => {
          res.resume()
          res.on('end', () => resolve(res.statusCode ?? 0))
        },
      )
      req.on('error', reject)
      req.write(body.slice(0, 10))
      setTimeout(() => req.end(body.slice(10)), 200)
    })
    await new Promise((r) => setTimeout(r, 50))

    let closed = false
    const closing = server.close().then(() => {
      closed = true
    })
    // New connections are refused straight away...
    await expect(fetch(`http://127.0.0.1:${server.port}/api/health`)).rejects.toThrow()
    expect(closed).toBe(false)
    // ...while the in-flight request still completes normally.
    expect(await response).toBe(200)
    await closing
    expect(closed).toBe(true)
  })

  it('closes the database only after the server has stopped', async () => {
    const order: string[] = []
    let finishClose!: () => void
    const fakeServer: RunningServer = {
      port: 0,
      close: () =>
        new Promise<void>((resolve) => {
          order.push('server close started')
          finishClose = () => {
            order.push('server closed')
            resolve()
          }
        }),
    }
    const fakeDb = { close: () => order.push('database closed') }
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    try {
      shutdownOnSignals(fakeServer, fakeDb as never, () => {})
      process.emit('SIGTERM')
      await new Promise((r) => setTimeout(r, 10))
      expect(order).toEqual(['server close started'])
      finishClose()
      await new Promise((r) => setTimeout(r, 10))
      expect(order).toEqual(['server close started', 'server closed', 'database closed'])
      expect(exit).toHaveBeenCalledWith(0)
    } finally {
      exit.mockRestore()
      process.removeAllListeners('SIGINT')
    }
  })
})

describe('main', () => {
  const dirs: string[] = []
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })
  const config = (dbPath: string) => ({
    BETTER_AUTH_URL: 'http://localhost:5173',
    BETTER_AUTH_SECRET: 'x'.repeat(40),
    DATABASE_PATH: dbPath,
    PORT: '0',
  })
  const tempDb = () => {
    const dir = mkdtempSync(join(tmpdir(), 'grampacker-main-'))
    dirs.push(dir)
    return join(dir, 'app.db')
  }

  it('refuses to serve a database with pending migrations', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await main(['serve'], config(tempDb()))).toBe(1)
      expect(String(error.mock.calls[0]?.[0])).toContain('migration(s) not applied')
    } finally {
      error.mockRestore()
    }
  })

  it('migrate applies the migrations, and a second run applies none', async () => {
    const path = tempDb()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(await main(['migrate'], config(path))).toBe(0)
      expect(await main(['migrate'], config(path))).toBe(0)
      expect(log.mock.calls.map((c) => String(c[0]))).toEqual([
        `applied 1 migration(s) to ${path}`,
        `applied 0 migration(s) to ${path}`,
      ])
    } finally {
      log.mockRestore()
    }
    const sqlite = openSqlite(path)
    expect(applyMigrations(sqlite)).toBe(0)
    sqlite.close()
  })

  it('stops on missing configuration before opening anything', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await main(['serve'], { DATABASE_PATH: tempDb() })).toBe(2)
      expect(String(error.mock.calls[0]?.[0])).toBe(
        'configuration error: BETTER_AUTH_URL is not set',
      )
    } finally {
      error.mockRestore()
    }
  })
})
