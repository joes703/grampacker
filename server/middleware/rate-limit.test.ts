import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../index'

const ORIGIN = 'http://localhost:5173'
const PASSWORD = 'a-long-test-password-123'

// Budgets under test (mirrors server/middleware/rate-limit.ts).
const SIGN_IN_LIMIT = 10
const SIGN_UP_LIMIT = 10
const EMAIL_SEND_LIMIT = 5
const SIGN_IN_WINDOW_MS = 10 * 60 * 1000

function authPost(path: string, body: unknown, ip: string) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        'cf-connecting-ip': ip,
      },
      body: JSON.stringify(body),
    },
    env,
  )
}

function signIn(ip: string, email = 'nobody@example.com') {
  return authPost('/api/auth/sign-in/email', { email, password: PASSWORD }, ip)
}

describe('auth rate limiting', () => {
  it('sign-in cuts off after the budget with Retry-After', async () => {
    const ip = '203.0.113.1'
    for (let i = 0; i < SIGN_IN_LIMIT; i++) {
      const res = await signIn(ip)
      expect(res.status).not.toBe(429)
    }
    const blocked = await signIn(ip)
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: 'Too many requests' })
    const retryAfter = Number(blocked.headers.get('Retry-After'))
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(SIGN_IN_WINDOW_MS / 1000)
  })

  it('buckets are per IP: another client is unaffected', async () => {
    const ip = '203.0.113.2'
    for (let i = 0; i <= SIGN_IN_LIMIT; i++) {
      await signIn(ip)
    }
    expect((await signIn(ip)).status).toBe(429)
    expect((await signIn('203.0.113.99')).status).not.toBe(429)
  })

  it('sign-up has its own stricter daily budget', async () => {
    const ip = '203.0.113.3'
    for (let i = 0; i < SIGN_UP_LIMIT; i++) {
      const res = await authPost(
        '/api/auth/sign-up/email',
        { email: `burst-${i}@example.com`, name: `Burst ${i}`, password: PASSWORD },
        ip,
      )
      expect(res.status).toBe(200)
    }
    const blocked = await authPost(
      '/api/auth/sign-up/email',
      { email: 'burst-over@example.com', name: 'Over', password: PASSWORD },
      ip,
    )
    expect(blocked.status).toBe(429)
  })

  it('verification-email resends have their own budget', async () => {
    // The account creation counts against sign-up, not email-send.
    const signUp = await authPost(
      '/api/auth/sign-up/email',
      { email: 'resend@example.com', name: 'Resend', password: PASSWORD },
      '203.0.113.4',
    )
    expect(signUp.status).toBe(200)

    for (let i = 0; i < EMAIL_SEND_LIMIT; i++) {
      const res = await authPost(
        '/api/auth/send-verification-email',
        { email: 'resend@example.com', callbackURL: '/' },
        '203.0.113.4',
      )
      expect(res.status).toBe(200)
    }
    const blocked = await authPost(
      '/api/auth/send-verification-email',
      { email: 'resend@example.com', callbackURL: '/' },
      '203.0.113.4',
    )
    expect(blocked.status).toBe(429)
  })

  it('the window expires: requests are allowed again afterwards', async () => {
    const ip = '203.0.113.5'
    for (let i = 0; i <= SIGN_IN_LIMIT; i++) {
      await signIn(ip)
    }
    expect((await signIn(ip)).status).toBe(429)

    // Rewind the stored window past expiry instead of waiting 10 minutes.
    await env.DB.prepare(
      'update rate_limits set window_start = window_start - ? where key = ?',
    )
      .bind(SIGN_IN_WINDOW_MS + 1000, `sign-in:${ip}`)
      .run()

    const afterExpiry = await signIn(ip)
    expect(afterExpiry.status).not.toBe(429)
  })

  it('the limit holds under a concurrent burst: no lost updates', { timeout: 30000 }, async () => {
    const ip = '203.0.113.7'
    const results = await Promise.all(
      Array.from({ length: SIGN_IN_LIMIT * 2 }, () => signIn(ip)),
    )
    // The atomic upsert assigns each request a distinct count, so the
    // split is exact - a lost update would show up as an extra allow.
    expect(results.filter((r) => r.status !== 429).length).toBe(SIGN_IN_LIMIT)
    expect(results.filter((r) => r.status === 429).length).toBe(SIGN_IN_LIMIT)
    const row = await env.DB.prepare(
      'select count from rate_limits where key = ?',
    )
      .bind(`sign-in:${ip}`)
      .first<{ count: number }>()
    expect(row?.count).toBe(SIGN_IN_LIMIT * 2)
  })

  it('requests without a client IP share the local fallback bucket', async () => {
    const post = () =>
      app.request(
        '/api/auth/sign-in/email',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
          body: JSON.stringify({ email: 'nobody@example.com', password: PASSWORD }),
        },
        env,
      )
    for (let i = 0; i < SIGN_IN_LIMIT; i++) {
      expect((await post()).status).not.toBe(429)
    }
    expect((await post()).status).toBe(429)
    const row = await env.DB.prepare(
      "select count from rate_limits where key = 'sign-in:local'",
    ).first<{ count: number }>()
    expect(row?.count).toBe(SIGN_IN_LIMIT + 1)
  })

  it('path tricks cannot reach better-auth without passing the limiter', async () => {
    // The limiter and the auth handler are mounted on the same '/auth/*'
    // pattern, so a path that evades one evades both. A case-mismatched
    // path also stops matching the CSRF middleware's /api/auth/* skip,
    // so it is refused as an ordinary unsafe request (403, missing CSRF
    // header) - and with the header it would 404. Never unlimited auth.
    const cased = await authPost(
      '/api/AUTH/sign-in/email',
      { email: 'nobody@example.com', password: PASSWORD },
      '203.0.113.8',
    )
    expect(cased.status).toBe(403)

    // Query strings do not split the bucket: exhaust with a query
    // string, then the plain path is already over budget.
    const ip = '203.0.113.9'
    for (let i = 0; i <= SIGN_IN_LIMIT; i++) {
      await authPost(
        `/api/auth/sign-in/email?attempt=${i}`,
        { email: 'nobody@example.com', password: PASSWORD },
        ip,
      )
    }
    expect((await signIn(ip)).status).toBe(429)
  })

  it('non-POST methods are not limited and not served by better-auth', async () => {
    const ip = '203.0.113.10'
    for (let i = 0; i <= SIGN_IN_LIMIT; i++) {
      await signIn(ip)
    }
    expect((await signIn(ip)).status).toBe(429)

    const options = await app.request(
      '/api/auth/sign-in/email',
      { method: 'OPTIONS', headers: { 'cf-connecting-ip': ip } },
      env,
    )
    expect(options.status).not.toBe(429)
    // The auth mount only registers GET and POST.
    expect(options.status).toBe(404)
  })

  it('a new window sweeps buckets expired for every scope, keeps active ones', async () => {
    const now = Date.now()
    await env.DB.prepare(
      'insert into rate_limits (key, count, window_start) values (?, 5, ?), (?, 3, ?)',
    )
      .bind(
        'sign-in:stale-ip',
        now - 25 * 60 * 60 * 1000, // > MAX_WINDOW_MS ago: expired for any scope
        'sign-up:fresh-ip',
        now - 60 * 1000, // active
      )
      .run()

    // First request for an unseen key starts a new window -> sweep runs.
    await signIn('203.0.113.11')

    const stale = await env.DB.prepare(
      "select 1 as one from rate_limits where key = 'sign-in:stale-ip'",
    ).first()
    const fresh = await env.DB.prepare(
      "select 1 as one from rate_limits where key = 'sign-up:fresh-ip'",
    ).first()
    expect(stale).toBeNull()
    expect(fresh).not.toBeNull()
  })

  it('GET auth requests are never limited', async () => {
    const ip = '203.0.113.6'
    for (let i = 0; i <= SIGN_IN_LIMIT; i++) {
      await signIn(ip)
    }
    expect((await signIn(ip)).status).toBe(429)

    const res = await app.request(
      '/api/auth/get-session',
      { headers: { 'cf-connecting-ip': ip } },
      env,
    )
    expect(res.status).toBe(200)
  })
})
