import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import app from '../index'
import { makeSessionStale, signInAgain, signUpVerifiedUser } from '../test/auth-helpers'
import { CSRF_HEADER } from '../../shared/api'

const ORIGIN = 'http://localhost:5173'

// The passkey endpoints that CHANGE WHICH CREDENTIALS CAN SIGN IN. If the
// plugin ever grows another, this list and server/middleware/fresh-auth.ts must
// both learn about it - an ungated one makes the gate theater. (update-passkey
// is NOT here: it renames a label, and is covered by the ungated test below.)
const GATED = [
  '/api/auth/passkey/generate-register-options',
  '/api/auth/passkey/verify-registration',
  '/api/auth/passkey/delete-passkey',
]

async function post(
  path: string,
  cookie: string,
  ip = '10.60.0.1',
): Promise<Response> {
  return app.request(
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        [CSRF_HEADER]: '1',
        'cf-connecting-ip': ip,
        Cookie: cookie,
      },
      body: JSON.stringify({}),
    },
    env,
  )
}

describe('passkey fresh-auth gate', () => {
  it('403s every credential change when the session is STALE', async () => {
    // The whole point: a valid session is NOT enough to plant or drop a
    // credential. A passkey planted with a stolen cookie outlives the session,
    // so only a RECENT ceremony may change the credential set.
    const { cookie } = await signUpVerifiedUser('fa-stale@test.dev', '')
    await makeSessionStale(cookie)

    for (const path of GATED) {
      const res = await post(path, cookie)
      expect(res.status, path).toBe(403)
      expect(await res.json(), path).toMatchObject({ code: 'REAUTH_REQUIRED' })
    }
  })

  it('lets a FRESH session through - signing in IS the proof', async () => {
    // No proof to mint, no password to type: the session minted by the sign-in
    // ceremony is itself the fresh-auth proof. This is the case that would have
    // been impossible under the old fresh_auth table, whose check inner-joined
    // the (now nonexistent) credential account and could never be satisfied.
    const { cookie } = await signUpVerifiedUser('fa-fresh@test.dev', '')

    for (const path of GATED) {
      // better-auth answers on its own terms (these bodies are empty, so a 4xx
      // from IT is expected) - what matters is that it is no longer OUR 403.
      const res = await post(path, cookie, '10.60.1.1')
      expect(res.status, path).not.toBe(403)
    }
  })

  it('a fresh ceremony un-stales the user: re-signing in mints a new session', async () => {
    // The recovery path. A stale session cannot be refreshed in place - the user
    // re-authenticates, which creates a NEW session, and the new one is fresh by
    // construction. Proves the re-auth loop the Settings UI depends on.
    const { cookie: stale } = await signUpVerifiedUser('fa-reauth@test.dev', '')
    await makeSessionStale(stale)
    expect((await post(GATED[2]!, stale, '10.60.1.2')).status).toBe(403)

    const { cookie: fresh } = await signInAgain('fa-reauth@test.dev')
    expect((await post(GATED[2]!, fresh, '10.60.1.3')).status).not.toBe(403)
  })

  it('leaves the OLD stale session stale after a re-auth elsewhere', async () => {
    // Freshness is per-session, measured from that session's own created_at, so
    // re-authenticating in one place must NOT hand a sensitive-action window to
    // a thief holding a cookie from another. Minting a new session does not
    // revoke or refresh the old one.
    const { cookie: stolen } = await signUpVerifiedUser('fa-persession@test.dev', '')
    await makeSessionStale(stolen)

    await signInAgain('fa-persession@test.dev')

    const res = await post(GATED[2]!, stolen, '10.60.1.4')
    expect(res.status).toBe(403)
  })

  it('401s an anonymous caller on a gated path', async () => {
    const res = await app.request(
      '/api/auth/passkey/delete-passkey',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          [CSRF_HEADER]: '1',
          'cf-connecting-ip': '10.60.0.3',
        },
        body: JSON.stringify({}),
      },
      env,
    )
    expect(res.status).toBe(401)
    // better-auth's dialect, like the 403 above - NOT the app's {error} shape.
    // This middleware answers inside /api/auth/*, which the SPA reads through
    // better-auth's client: PasskeySection keys off `code`, auth-errors renders
    // `message`. Answering {error} here would be a shape nothing on this path
    // reads.
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('leaves RENAME ungated even for a stale session', async () => {
    // A rename changes a display label. It cannot add, remove, or alter a
    // credential, so the gate has nothing to protect here and would only cost
    // the owner a ceremony. better-auth will reject this empty body on its own
    // terms - what matters is that OUR gate did not.
    const { cookie } = await signUpVerifiedUser('fa-rename@test.dev', '')
    await makeSessionStale(cookie)

    const res = await post('/api/auth/passkey/update-passkey', cookie, '10.60.0.6')
    expect(res.status).not.toBe(403)
  })

  it('leaves the passkey SIGN-IN ceremony and the read ungated', async () => {
    // Gating these would be a self-inflicted outage: the sign-in endpoints are
    // anonymous by definition (you cannot prove a fresh session with a session
    // you do not have yet), and list is a read.
    for (const path of [
      '/api/auth/passkey/generate-authenticate-options',
      '/api/auth/passkey/verify-authentication',
    ]) {
      const res = await app.request(
        path,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            [CSRF_HEADER]: '1',
            'cf-connecting-ip': '10.60.0.4',
          },
          body: JSON.stringify({}),
        },
        env,
      )
      expect(res.status, path).not.toBe(403)
    }

    const { cookie } = await signUpVerifiedUser('fa-read@test.dev', '')
    await makeSessionStale(cookie)
    const list = await app.request(
      '/api/auth/passkey/list-user-passkeys',
      {
        method: 'GET',
        headers: { Origin: ORIGIN, Cookie: cookie, 'cf-connecting-ip': '10.60.0.5' },
      },
      env,
    )
    expect(list.status).toBe(200)
  })
})
