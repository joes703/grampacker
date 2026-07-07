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
