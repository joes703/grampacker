import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from './index'

// server/middleware/csrf.ts intentionally skips /api/auth/* because better-auth
// runs its OWN origin validation against BETTER_AUTH_URL. SECURITY.md and
// docs/authz-matrix.md both state a forged auth origin is rejected 403
// INVALID_ORIGIN, but the direct CSRF tests only covered non-auth routes. This
// pins better-auth's behavior directly against a real auth endpoint.
//
// Key detail (verified in better-auth's origin-check middleware): the Origin is
// only validated when the request carries a Cookie (the browser CSRF case) or
// an internal forceValidate. A cookieless cross-site POST is already inert -
// SameSite=Strict means no ambient cookie, and no CORS means the response is
// unreadable - so better-auth skips the check there. The test therefore sends a
// cookie to exercise the real validation path.

const TRUSTED_ORIGIN = 'http://localhost:5173' // == BETTER_AUTH_URL under test

function signInFrom(origin: string, ip: string) {
  return app.request(
    '/api/auth/sign-in/email',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        // A cookie is what makes better-auth run the origin check; its contents
        // are irrelevant because the origin check fires before session parsing.
        Cookie: 'better-auth.session_token=irrelevant',
        'cf-connecting-ip': ip,
      },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'a-long-test-password-123' }),
    },
    env,
  )
}

describe('better-auth origin validation on /api/auth/*', () => {
  it('rejects a forged Origin with 403 INVALID_ORIGIN', async () => {
    const res = await signInFrom('https://evil.example.com', '198.51.100.7')
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code?: string; message?: string }
    expect(body.code).toBe('INVALID_ORIGIN')
  })

  it('lets the same request through the origin gate when the Origin is trusted', async () => {
    // Identical shape from the trusted origin: origin validation passes, so the
    // request fails LATER as ordinary bad credentials (not 403). This proves the
    // 403 above is specifically origin validation, not some unrelated rejection.
    const res = await signInFrom(TRUSTED_ORIGIN, '198.51.100.8')
    expect(res.status).not.toBe(403)
  })
})
