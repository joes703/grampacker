import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { checkHealth, healthUrl } from './healthcheck'

// The container's HEALTHCHECK (Dockerfile). Healthy means HTTP 200 AND a JSON
// body whose `ok` is exactly true, within the timeout
// Every other answer is unhealthy, and
// the reason is printed so `docker inspect` shows why.

let server: Server | undefined

afterEach(async () => {
  const s = server
  server = undefined
  if (s) {
    s.closeAllConnections()
    await new Promise((resolve) => s.close(resolve))
  }
})

// A stub that answers every request with `respond`. Returns its health URL.
async function stub(respond: (res: ServerResponse) => void): Promise<string> {
  server = createServer((_req, res) => respond(res))
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}/api/health`
}

function answer(status: number, body: string) {
  return (res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body)
  }
}

describe('checkHealth', () => {
  it('is healthy on 200 with ok exactly true', async () => {
    expect(await checkHealth(await stub(answer(200, '{"ok":true}')), 1000)).toBeNull()
  })

  it.each([
    ['ok false', 200, '{"ok":false}'],
    ['ok as a string', 200, '{"ok":"true"}'],
    ['ok as a number', 200, '{"ok":1}'],
    ['no ok property', 200, '{}'],
    ['JSON null', 200, 'null'],
    ['a JSON array', 200, '[true]'],
    ['an empty body', 200, ''],
    ['a body that is not JSON', 200, '<!doctype html><html></html>'],
    ['a 500 that says ok', 500, '{"ok":true}'],
    ['a 204', 204, ''],
  ])('is unhealthy on %s', async (_name, status, body) => {
    const reason = await checkHealth(await stub(answer(status, body)), 1000)
    expect(reason).toEqual(expect.any(String))
  })

  it('does not follow a redirect to a healthy answer', async () => {
    const url = await stub((res) => {
      if (res.req.url === '/elsewhere') return answer(200, '{"ok":true}')(res)
      res.writeHead(302, { location: '/elsewhere' })
      res.end()
    })
    expect(await checkHealth(url, 1000)).toMatch(/302/)
  })

  it('is unhealthy when the headers never arrive within the timeout', async () => {
    const url = await stub(() => {})
    const started = Date.now()
    expect(await checkHealth(url, 200)).toMatch(/timeout|abort/i)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('is unhealthy when the body never finishes within the timeout', async () => {
    const url = await stub((res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"ok":')
    })
    const started = Date.now()
    expect(await checkHealth(url, 200)).toMatch(/timeout|abort/i)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('is unhealthy when nothing listens', async () => {
    const url = await stub(answer(200, '{"ok":true}'))
    const s = server
    server = undefined
    await new Promise((resolve) => s?.close(resolve))
    expect(await checkHealth(url, 1000)).toEqual(expect.any(String))
  })
})

describe('healthUrl', () => {
  it('uses the loopback address and the server port, 3000 by default', () => {
    expect(healthUrl({})).toBe('http://127.0.0.1:3000/api/health')
    expect(healthUrl({ PORT: '8080' })).toBe('http://127.0.0.1:8080/api/health')
  })
})
