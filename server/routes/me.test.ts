import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { meResponseSchema } from '../../shared/me'
import { CSRF_HEADER } from '../middleware/csrf'
import { signUpVerifiedUser } from '../test/auth-helpers'

const ORIGIN = 'http://localhost:5173'

function putMe(cookie: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(
    '/api/me',
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        [CSRF_HEADER]: '1',
        Cookie: cookie,
        ...headers,
      },
      body: JSON.stringify(body),
    },
    env,
  )
}

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
    expect(Object.keys(body).sort()).toEqual(
      ['createdAt', 'email', 'emailVerified', 'id', 'name'].sort(),
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

  it('PUT updates the name and returns the DTO', async () => {
    const { cookie } = await signUpVerifiedUser('me-rename@example.com', 'Before')
    const res = await putMe(cookie, { name: 'After' })
    expect(res.status).toBe(200)
    const body = meResponseSchema.parse(await res.json())
    expect(body.name).toBe('After')
  })

  it('PUT without the custom header is 403', async () => {
    const { cookie } = await signUpVerifiedUser('me-nocsrf@example.com', 'NoCsrf')
    const res = await app.request(
      '/api/me',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: JSON.stringify({ name: 'Blocked' }),
      },
      env,
    )
    expect(res.status).toBe(403)
  })

  it('PUT with a forged origin is 403', async () => {
    const { cookie } = await signUpVerifiedUser('me-origin@example.com', 'Origin')
    const res = await putMe(cookie, { name: 'Blocked' }, { Origin: 'https://evil.example' })
    expect(res.status).toBe(403)
  })

  it('anon PUT (with header, no session) is 401', async () => {
    const res = await app.request(
      '/api/me',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          [CSRF_HEADER]: '1',
        },
        body: JSON.stringify({ name: 'Anon' }),
      },
      env,
    )
    expect(res.status).toBe(401)
  })

  it('PUT rejects invalid bodies with 400', async () => {
    const { cookie } = await signUpVerifiedUser('me-invalid@example.com', 'Invalid')
    expect((await putMe(cookie, { name: '' })).status).toBe(400)
    expect((await putMe(cookie, { name: 'x'.repeat(121) })).status).toBe(400)
    expect((await putMe(cookie, {})).status).toBe(400)
  })
})
