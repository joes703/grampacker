import { env } from './test/node-env'
import { describe, expect, it } from 'vitest'
import app from './index'
import { lastEmailTo } from './email/console'

// server/middleware/csrf.ts intentionally skips /api/auth/* because better-auth
// runs its OWN origin validation against BETTER_AUTH_URL. SECURITY.md and
// docs/authz-matrix.md both state a forged auth origin is rejected 403
// INVALID_ORIGIN, but the direct CSRF tests only covered non-auth routes. This
// pins better-auth's behavior directly against a real auth endpoint.
//
// Key detail (verified in better-auth's origin-check middleware): on the core
// routes the Origin is only validated when the request carries a Cookie (the
// browser CSRF case) or an internal forceValidate. For CSRF that skip is sound -
// SameSite=Strict means no ambient cookie, and no CORS means the response is
// unreadable - so a cookieless cross-site POST cannot act as the user. The tests
// below therefore send a cookie to exercise the core validation path.
//
// That reasoning does NOT cover an endpoint whose SIDE EFFECT is the attack.
// /sign-in/magic-link sends mail to the address in the body, and an attacker
// needs neither a cookie nor a readable response to abuse that. better-auth
// 1.6.24 closed the BROWSER half (PR #10368) by attaching formCsrfMiddleware to
// the plugin's send endpoint, so a cookieless cross-origin send is now rejected
// outright. The third test pins that so a downgrade cannot silently reopen it.
//
// What that fix is NOT is an abuse boundary. Origin validation only constrains
// a browser, which cannot forge the header; a direct HTTP caller sets whatever
// Origin it likes, including the trusted one, and sails through. Upstream also
// deliberately allows a request carrying no Cookie, Fetch Metadata, Origin or
// Referer at all, so that server-to-server callers keep working - that carve-out
// is what the fourth test pins.
//
// So the mail quota in server/middleware/rate-limit.ts (MAGIC_LINK_SEND_GLOBAL)
// is not a stand-in for the missing origin check and does not become redundant
// now that the check exists: it bounds the provider's daily cap across EVERY
// validated send, however the caller presents itself. The per-IP and
// per-address buckets in that same file bound the other two axes. #10368
// narrows who can reach the send path from a browser; it does not bound how
// much mail the path can emit.

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
        'x-forwarded-for': ip,
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
      env,
    )
    expect(res.status).toBe(403)
    // Asserted so this cannot pass for an unrelated reason - a 429 from the
    // rate-limit middleware or a generic refusal would not carry this code.
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('INVALID_ORIGIN')
  })

  // The deliberate server-to-server carve-out in #10368: no Cookie, no Fetch
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
      env,
    )
    expect(res.status).toBe(200)
    // Proves the request reached sendMagicLink - i.e. that this shape really
    // can emit mail, which is what MAGIC_LINK_SEND_GLOBAL exists to bound.
    expect(lastEmailTo(to)).toBeDefined()
  })
})
