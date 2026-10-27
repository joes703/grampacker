import { createApp } from '../index'
import { env } from '../test/node-env'
import { describe, expect, it } from 'vitest'

// Prod-like env: /api/health never touches better-auth, so overriding the
// canonical origin is safe and makes the middleware emit the full
// production set (the test default is localhost = dev mode).
const prodEnv = { ...env, BETTER_AUTH_URL: 'https://grampacker.app' }

// The exact production set: our values where they are stricter or specific to
// this app, Hono's secureHeaders defaults for the rest.
const PRODUCTION_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
    "connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; " +
    "form-action 'self'; manifest-src 'self'; worker-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
  'X-DNS-Prefetch-Control': 'off',
  'X-Download-Options': 'noopen',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'X-XSS-Protection': '0',
}

function expectProductionHeaders(res: Response) {
  for (const [key, value] of Object.entries(PRODUCTION_HEADERS)) {
    expect(res.headers.get(key), key).toBe(value)
  }
}

describe('security headers on the real app', () => {
  it('API responses carry the full production set', async () => {
    const res = await createApp(prodEnv).request('/api/health', {})
    expect(res.status).toBe(200)
    expectProductionHeaders(res)
  })

  it('development omits only the CSP', async () => {
    const res = await createApp(env).request('/api/health', {})
    expect(res.headers.get('Content-Security-Policy')).toBeNull()
    for (const [key, value] of Object.entries(PRODUCTION_HEADERS)) {
      if (key !== 'Content-Security-Policy') expect(res.headers.get(key), key).toBe(value)
    }
  })

  it('error responses carry the set too', async () => {
    // A CSRF-refused request still gets headers: the middleware wraps
    // every response, not just happy paths.
    const res = await createApp(prodEnv).request(
      '/api/me',
      { method: 'PUT', body: '{}' },
    )
    expect(res.status).toBe(403)
    expectProductionHeaders(res)
  })

  it('unknown /api/* paths return JSON 404, not the SPA shell', async () => {
    const res = await createApp(prodEnv).request('/api/definitely-not-a-route', {})
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type') ?? '').toContain('application/json')
  })

  it('the SPA shell carries the full production set', async () => {
    const res = await createApp(prodEnv).request('/', {})
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') ?? '').toContain('text/html')
    expectProductionHeaders(res)
  })
})
