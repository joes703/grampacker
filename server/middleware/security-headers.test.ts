import { env } from '../test/node-env'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { securityHeaderMap } from './security-headers'

// Prod-like env: /api/health never touches better-auth, so overriding the
// canonical origin is safe and makes the middleware emit the full
// production set (the test default is localhost = dev mode).
const prodEnv = { ...env, BETTER_AUTH_URL: 'https://grampacker.app' }

// Directive names are case-insensitive per CSP, hence the lowercase.
function parseCsp(csp: string): Map<string, string> {
  const directives = new Map<string, string>()
  for (const raw of csp.split(';')) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    const name = trimmed.split(/\s+/)[0]!.toLowerCase()
    // Browsers honor the FIRST occurrence and ignore later duplicates, so a
    // duplicate is a silent way to make a policy read stricter than it enforces.
    // Refuse to parse one rather than quietly keeping the first.
    if (directives.has(name)) {
      throw new Error(`duplicate CSP directive: ${name}`)
    }
    directives.set(name, trimmed)
  }
  return directives
}

describe('security headers', () => {
  it('dev mode drops exactly one header: the CSP', () => {
    const prod = securityHeaderMap({ dev: false })
    const dev = securityHeaderMap({ dev: true })
    expect(prod['Content-Security-Policy']).toBeDefined()
    expect(dev['Content-Security-Policy']).toBeUndefined()
    expect(Object.keys(prod).filter((k) => k !== 'Content-Security-Policy')).toEqual(
      Object.keys(dev),
    )
  })

  it('the production CSP keeps the load-bearing directives', () => {
    const csp = securityHeaderMap({ dev: false })['Content-Security-Policy'] ?? ''
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]) {
      expect(csp).toContain(directive)
    }
    // React styles go through the CSSOM, so nothing needs inline
    // allowances - keep it that way.
    expect(csp).not.toContain('unsafe-inline')
    // The Supabase origins died with the old stack.
    expect(csp).not.toContain('supabase')
  })

  it('authorizes no third-party script or connection origins', () => {
    const csp = parseCsp(securityHeaderMap({ dev: false })['Content-Security-Policy'] ?? '')
    expect(csp.get('script-src')).toBe("script-src 'self'")
    expect(csp.get('connect-src')).toBe("connect-src 'self'")
    expect(csp.get('default-src')).toBe("default-src 'self'")
    expect(csp.has('script-src-elem')).toBe(false)
    expect(csp.has('script-src-attr')).toBe(false)
    expect([...csp.values()].join('; ')).not.toMatch(/https?:\/\//)
  })

  it('API responses carry the full production set', async () => {
    const res = await app.request('/api/health', {}, prodEnv)
    expect(res.status).toBe(200)
    for (const [key, value] of Object.entries(securityHeaderMap({ dev: false }))) {
      expect(res.headers.get(key)).toBe(value)
    }
  })

  it('error responses carry the set too', async () => {
    // A CSRF-refused request still gets headers: the middleware wraps
    // every response, not just happy paths.
    const res = await app.request(
      '/api/me',
      { method: 'PUT', body: '{}' },
      prodEnv,
    )
    expect(res.status).toBe(403)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Security-Policy')).toBeDefined()
  })

  it('unknown /api/* paths return JSON 404, not the SPA shell', async () => {
    const res = await app.request('/api/definitely-not-a-route', {}, prodEnv)
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type') ?? '').toContain('application/json')
  })

  it('the SPA shell carries the full production set', async () => {
    const res = await app.request('/', {}, prodEnv)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') ?? '').toContain('text/html')
    for (const [key, value] of Object.entries(securityHeaderMap({ dev: false }))) {
      expect(res.headers.get(key)).toBe(value)
    }
  })
})
