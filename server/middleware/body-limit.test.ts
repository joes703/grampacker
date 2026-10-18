import { env, testDb } from '../test/node-env'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { API_BODY_LIMIT_BYTES, IMPORT_BODY_LIMIT_BYTES } from './body-limit'

// The limit middleware is registered before CSRF, rate limiting, and
// auth, so an oversized body must come back 413 with NO auth state and
// NO rate-limit spend - these tests deliberately omit the CSRF header
// and session cookie to pin that ordering.

const oversized = 'x'.repeat(API_BODY_LIMIT_BYTES + 1)

describe('api body limit', () => {
  it('refuses an oversized body before CSRF/auth can run', async () => {
    const res = await app.request(
      '/api/gear-items',
      { method: 'POST', body: oversized },
      env,
    )
    expect(res.status).toBe(413)
    expect(res.headers.get('content-type') ?? '').toContain('application/json')
    // Error responses still carry the security-header map.
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('a body exactly at the limit passes through to the next refusal (CSRF 403)', async () => {
    const res = await app.request(
      '/api/gear-items',
      { method: 'POST', body: 'x'.repeat(API_BODY_LIMIT_BYTES) },
      env,
    )
    expect(res.status).toBe(403)
  })

  it('covers /api/auth/* and refuses without spending rate-limit budget', async () => {
    const res = await app.request(
      '/api/auth/sign-in/email',
      {
        method: 'POST',
        body: oversized,
        headers: { 'x-forwarded-for': '10.98.0.1' },
      },
      env,
    )
    expect(res.status).toBe(413)
    const row = await testDb.prepare(
      'select count(*) as n from rate_limits',
    ).first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  // A full CSV import runs past 128 KB, so the two import routes get a 2 MB
  // cap. They must not inherit the standard cap, and the larger cap must not
  // reach any other route. A body under the cap is refused next by CSRF
  // (403), which proves the limit let it through.
  describe.each(['/api/gear-items/import', '/api/lists/import'])('%s', (path) => {
    it('accepts a body over the standard limit', async () => {
      const res = await app.request(path, { method: 'POST', body: oversized }, env)
      expect(res.status).toBe(403)
    })

    it('still refuses a body over the import limit', async () => {
      const res = await app.request(
        path,
        { method: 'POST', body: 'x'.repeat(IMPORT_BODY_LIMIT_BYTES + 1) },
        env,
      )
      expect(res.status).toBe(413)
    })
  })

  it('keeps the standard limit on a path that only starts like an import path', async () => {
    const res = await app.request(
      '/api/gear-items/import-preview',
      { method: 'POST', body: oversized },
      env,
    )
    expect(res.status).toBe(413)
  })
})
