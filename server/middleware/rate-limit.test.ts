import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../index'

const ORIGIN = 'http://localhost:5173'
const PASSWORD = 'a-long-test-password-123'

// Budgets under test (mirrors server/middleware/rate-limit.ts).
const SIGN_IN_LIMIT = 10
const SIGN_UP_LIMIT = 10
const EMAIL_SEND_LIMIT = 5
const AUTH_DEFAULT_LIMIT = 30
const SENSITIVE_LIMIT = 5
const SIGN_IN_WINDOW_MS = 10 * 60 * 1000
const SENSITIVE_WINDOW_MS = 10 * 60 * 1000

// change-password/delete-user need no valid session to exercise the limiter:
// it counts every attempt before auth runs, so an anonymous burst (which the
// handler would 400/401) still consumes the bucket. A long newPassword keeps
// change-password past the 12-char floor even though it never reaches that check.
const NEW_PASSWORD = 'another-long-password-1'

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

  it('change-password gets its own tighter sensitive budget with Retry-After', async () => {
    const ip = '203.0.113.20'
    for (let i = 0; i < SENSITIVE_LIMIT; i++) {
      const res = await authPost(
        '/api/auth/change-password',
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        ip,
      )
      expect(res.status).not.toBe(429)
    }
    const blocked = await authPost(
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      ip,
    )
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: 'Too many requests' })
    const retryAfter = Number(blocked.headers.get('Retry-After'))
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(SENSITIVE_WINDOW_MS / 1000)
  })

  it('delete-user gets its own tighter sensitive budget with Retry-After', async () => {
    const ip = '203.0.113.21'
    for (let i = 0; i < SENSITIVE_LIMIT; i++) {
      const res = await authPost('/api/auth/delete-user', { password: PASSWORD }, ip)
      expect(res.status).not.toBe(429)
    }
    const blocked = await authPost('/api/auth/delete-user', { password: PASSWORD }, ip)
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: 'Too many requests' })
    const retryAfter = Number(blocked.headers.get('Retry-After'))
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(SENSITIVE_WINDOW_MS / 1000)
  })

  it('sensitive endpoints keep independent buckets from each other', async () => {
    const ip = '203.0.113.22'
    // Exhaust change-password for this IP.
    for (let i = 0; i <= SENSITIVE_LIMIT; i++) {
      await authPost(
        '/api/auth/change-password',
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        ip,
      )
    }
    expect(
      (
        await authPost(
          '/api/auth/change-password',
          { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
          ip,
        )
      ).status,
    ).toBe(429)
    // delete-user on the SAME IP is untouched: distinct scope, distinct bucket.
    expect((await authPost('/api/auth/delete-user', { password: PASSWORD }, ip)).status).not.toBe(
      429,
    )
  })

  it('sensitive endpoints cut off well before the generic auth bucket would', async () => {
    // change-password stops at 5...
    const sensitiveIp = '203.0.113.23'
    for (let i = 0; i < SENSITIVE_LIMIT; i++) {
      expect(
        (
          await authPost(
            '/api/auth/change-password',
            { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
            sensitiveIp,
          )
        ).status,
      ).not.toBe(429)
    }
    expect(
      (
        await authPost(
          '/api/auth/change-password',
          { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
          sensitiveIp,
        )
      ).status,
    ).toBe(429)
    // ...while a generic auth endpoint on a fresh IP sails past 5 (budget 30).
    const genericIp = '203.0.113.24'
    for (let i = 0; i < SENSITIVE_LIMIT + 2; i++) {
      expect((await authPost('/api/auth/sign-out', {}, genericIp)).status).not.toBe(429)
    }
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

  it('the limiter is method-agnostic: OPTIONS shares the bucket', async () => {
    // Fail-closed posture: every method is limited unless it is an
    // allowlisted read-only GET. An OPTIONS never reaches a handler
    // (the auth mount only registers GET and POST) but still counts.
    const ip = '203.0.113.10'
    const options = () =>
      app.request(
        '/api/auth/sign-in/email',
        { method: 'OPTIONS', headers: { 'cf-connecting-ip': ip } },
        env,
      )
    expect((await options()).status).toBe(404)

    for (let i = 0; i <= SIGN_IN_LIMIT; i++) {
      await signIn(ip)
    }
    expect((await options()).status).toBe(429)
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

  it('challenge-generating GETs are limited and stop writing challenges', async () => {
    // Regression for the PR #10 blocker: the passkey plugin's
    // /passkey/generate-authenticate-options is an UNAUTHENTICATED GET
    // that writes a verification row per call. The old exempt-all-GETs
    // rule left it as an unguarded write path. Prove the GET itself
    // consumes budget, gets cut off, and that a blocked request writes
    // no verification row.
    const ip = '203.0.113.12'
    const challenge = () =>
      app.request(
        '/api/auth/passkey/generate-authenticate-options',
        { headers: { 'cf-connecting-ip': ip } },
        env,
      )
    for (let i = 0; i < AUTH_DEFAULT_LIMIT; i++) {
      expect((await challenge()).status).not.toBe(429)
    }
    const before = await env.DB.prepare(
      'select count(*) as n from verification',
    ).first<{ n: number }>()
    const blocked = await challenge()
    expect(blocked.status).toBe(429)
    const after = await env.DB.prepare(
      'select count(*) as n from verification',
    ).first<{ n: number }>()
    expect(after?.n).toBe(before?.n)
  })

  it('allowlisted read-only GETs are never limited', async () => {
    // Exhaust the shared default 'auth' bucket for this IP with cheap
    // sign-out POSTs, then confirm the session poll still passes while
    // a non-allowlisted request on the same bucket is refused.
    const ip = '203.0.113.6'
    for (let i = 0; i <= AUTH_DEFAULT_LIMIT; i++) {
      await authPost('/api/auth/sign-out', {}, ip)
    }
    expect((await authPost('/api/auth/sign-out', {}, ip)).status).toBe(429)

    const session = await app.request(
      '/api/auth/get-session',
      { headers: { 'cf-connecting-ip': ip } },
      env,
    )
    expect(session.status).toBe(200)
  })
})
