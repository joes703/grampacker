import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import app from '../index'
import { signUpVerifiedUser, TEST_PASSWORD } from '../test/auth-helpers'
import { CSRF_HEADER } from '../../shared/api'

const ORIGIN = 'http://localhost:5173'

// Every test drives its own client IP. The limiter buckets by scope+IP, and
// the reauth budget is 5/10min, so tests sharing one IP spend each other's
// budget and later ones get a 429 they never asked for. (CI caught exactly
// that: the limiter working correctly, against the tests.)
async function reauth(
  cookie: string | null,
  body: unknown,
  ip: string,
): Promise<Response> {
  return app.request(
    '/api/me/reauth',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        [CSRF_HEADER]: '1',
        'cf-connecting-ip': ip,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    },
    env,
  )
}

describe('POST /api/me/reauth', () => {
  it('401s an anonymous caller', async () => {
    const res = await reauth(null, { password: TEST_PASSWORD }, '10.50.0.1')
    expect(res.status).toBe(401)
  })

  it('mints a proof for the correct password', async () => {
    const { cookie } = await signUpVerifiedUser('reauth-ok@test.dev', '')
    const res = await reauth(cookie, { password: TEST_PASSWORD }, '10.50.0.2')
    expect(res.status).toBe(204)

    const row = await env.DB.prepare('select count(*) as n from fresh_auth')
      .first<{ n: number }>()
    expect(row?.n).toBe(1)
  })

  it('rejects a wrong password without minting a proof', async () => {
    const { cookie } = await signUpVerifiedUser('reauth-bad@test.dev', '')
    const res = await reauth(cookie, { password: 'not-the-password' }, '10.50.0.3')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'INVALID_PASSWORD' })

    const row = await env.DB.prepare(
      'select count(*) as n from fresh_auth where user_id = (select id from user where email = ?)',
    )
      .bind('reauth-bad@test.dev')
      .first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  it('answers a malformed body the same way as a wrong password', async () => {
    // No oracle: an attacker must not be able to tell "you sent junk" from
    // "wrong password" and use the difference to probe.
    const { cookie } = await signUpVerifiedUser('reauth-junk@test.dev', '')
    // A fresh IP per body: four malformed attempts would otherwise eat most of
    // one bucket's 5/10min budget and the last would 429 instead of 400.
    const bodies = [{}, { password: '' }, { password: 1 }, { pw: 'x' }]
    for (const [i, body] of bodies.entries()) {
      const res = await reauth(cookie, body, `10.52.1.${i + 1}`)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'INVALID_PASSWORD' })
    }
  })

  it('is rate limited: it is a password-guessing oracle', async () => {
    // The SENSITIVE budget is 5/10min, same as change-password/delete-user.
    // Without a limiter here, this endpoint would be the cheapest way in the
    // app to guess a password.
    const { cookie } = await signUpVerifiedUser('reauth-rl@test.dev', '')
    const ip = '10.51.0.9'
    const codes: number[] = []
    for (let i = 0; i < 7; i++) {
      const res = await reauth(cookie, { password: 'wrong-guess' }, ip)
      codes.push(res.status)
    }
    expect(codes.filter((c) => c === 400)).toHaveLength(5)
    expect(codes.filter((c) => c === 429)).toHaveLength(2)
  })

  it('requires the anti-CSRF header', async () => {
    const { cookie } = await signUpVerifiedUser('reauth-csrf@test.dev', '')
    const res = await app.request(
      '/api/me/reauth',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: JSON.stringify({ password: TEST_PASSWORD }),
      },
      env,
    )
    expect(res.status).toBe(403)
  })
})
