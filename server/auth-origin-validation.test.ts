import { app } from './test/node-env'
import { describe, expect, it } from 'vitest'
import { lastEmailTo } from './email/console'

// App writes use our CSRF header; auth uses better-auth's origin check.
// Direct HTTP clients can omit Origin, so that check cannot bound mail abuse.
// MAGIC_LINK_SEND_GLOBAL covers every validated attempt, including those clients.

const TRUSTED_ORIGIN = 'http://localhost:5173' // == BETTER_AUTH_URL under test

function signInFrom(origin: string, ip: string) {
  return app.request(
    '/api/auth/sign-in/magic-link',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        // A cookie is what makes better-auth run the origin check; its contents
        // are irrelevant because the origin check fires before session parsing.
        Cookie: 'better-auth.session_token=irrelevant',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify({ email: 'trusted-origin@example.com' }),
    },
  )
}

describe('better-auth origin validation on /api/auth/*', () => {
  it('refuses a forged Origin and completes the trusted-origin send', async () => {
    const forged = await signInFrom('https://evil.example.com', '198.51.100.7')
    expect(forged.status).toBe(403)
    expect(await forged.json()).toMatchObject({ code: 'INVALID_ORIGIN' })
    expect(lastEmailTo('trusted-origin@example.com')).toBeUndefined()
    const trusted = await signInFrom(TRUSTED_ORIGIN, '198.51.100.8')
    expect(trusted.status).toBe(200)
    expect(lastEmailTo('trusted-origin@example.com')).toBeDefined()
  })

  // No Cookie header at all - the shape the core routes deliberately let past.
  // On the magic-link send endpoint it must still be refused, because the harm
  // is the outbound email rather than anything the attacker gets to read.
  it('rejects a COOKIELESS cross-origin magic-link send', async () => {
    const res = await app.request(
      '/api/auth/sign-in/magic-link',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example.com',
          'x-forwarded-for': '198.51.100.9',
        },
        body: JSON.stringify({ email: 'victim@example.com' }),
      },
    )
    expect(res.status).toBe(403)
    // Asserted so this cannot pass for an unrelated reason - a 429 from the
    // rate-limit middleware or a generic refusal would not carry this code.
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('INVALID_ORIGIN')
  })

  // A direct HTTP request: no Cookie, no Fetch
  // Metadata, no Origin, no Referer means validateFormCsrf returns early and
  // the send proceeds. Asserted as a completed send - 200 AND mail in the
  // outbox - rather than `not 403`, which would also pass on a 400 schema
  // rejection, a 429 from the rate limiter, or a 500, and so would prove
  // nothing about reaching sendMagicLink.
  //
  // A unique recipient keeps this from colliding with the parallel suites that
  // share one process and read the same outbox.
  it('completes an originless magic-link send (the server-to-server carve-out)', async () => {
    const to = 'originless-carveout@example.com'
    const res = await app.request(
      '/api/auth/sign-in/magic-link',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
        body: JSON.stringify({ email: to }),
      },
    )
    expect(res.status).toBe(200)
    // Proves the request reached sendMagicLink - i.e. that this shape really
    // can emit mail, which is what MAGIC_LINK_SEND_GLOBAL exists to bound.
    expect(lastEmailTo(to)).toBeDefined()
  })
})
