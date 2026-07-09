import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { meResponseSchema } from '../../shared/me'
import { signUpVerifiedUser } from '../test/auth-helpers'

// /api/me is GET-only: the former PUT existed solely to update the display
// name, and grampacker no longer collects or stores one (data-minimization
// call, 2026-07-09). The cross-cutting CSRF tests that used that PUT as
// their vehicle live in server/middleware/csrf.test.ts now.

describe('/api/me authorization matrix', () => {
  it('anon GET is 401', async () => {
    const res = await app.request('/api/me', {}, env)
    expect(res.status).toBe(401)
  })

  it('owner GET returns own profile shaped by the DTO allowlist', async () => {
    const { cookie } = await signUpVerifiedUser('me-owner@example.com', 'Owner')
    const res = await app.request('/api/me', { headers: { Cookie: cookie } }, env)
    expect(res.status).toBe(200)
    const body = meResponseSchema.parse(await res.json())
    expect(body.email).toBe('me-owner@example.com')
    expect(body.emailVerified).toBe(true)
    // The allowlist holds: nothing beyond the DTO's keys leaves the server.
    // No `name` - see the data-minimization note above.
    expect(Object.keys(body).sort()).toEqual(
      ['createdAt', 'email', 'emailVerified', 'id'].sort(),
    )
  })

  it('two sessions each see only their own row', async () => {
    const a = await signUpVerifiedUser('me-a@example.com', 'UserA')
    const b = await signUpVerifiedUser('me-b@example.com', 'UserB')
    const resA = await app.request('/api/me', { headers: { Cookie: a.cookie } }, env)
    const resB = await app.request('/api/me', { headers: { Cookie: b.cookie } }, env)
    const bodyA = meResponseSchema.parse(await resA.json())
    const bodyB = meResponseSchema.parse(await resB.json())
    expect(bodyA.email).toBe('me-a@example.com')
    expect(bodyB.email).toBe('me-b@example.com')
    expect(bodyA.id).not.toBe(bodyB.id)
  })

  it('PUT is gone: unsafe methods on /api/me are JSON 404, not the SPA shell', async () => {
    const { cookie } = await signUpVerifiedUser('me-noput@example.com', 'NoPut')
    const res = await app.request(
      '/api/me',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
          'x-grampacker-request': '1',
          Cookie: cookie,
        },
        body: JSON.stringify({ name: 'ghost' }),
      },
      env,
    )
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

describe('user name is never stored', () => {
  it('sign-up posting a name stores an empty string (databaseHooks blank it server-side)', async () => {
    // The helper deliberately still POSTS a name - better-auth's sign-up
    // schema requires the key - so this drives the exact surface the
    // databaseHooks guard: a client that submits a name anyway.
    await signUpVerifiedUser('me-noname@example.com', 'Should Be Dropped')
    const row = await env.DB.prepare('select name from user where email = ?')
      .bind('me-noname@example.com')
      .first<{ name: string }>()
    expect(row?.name).toBe('')
  })
})
