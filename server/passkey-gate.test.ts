import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import app from './index'
import { makeSessionStale, signInAgain, signUpVerifiedUser } from './test/auth-helpers'
import { CSRF_HEADER } from '../shared/api'

const ORIGIN = 'http://localhost:5173'

// The passkey endpoints that CHANGE WHICH CREDENTIALS CAN SIGN IN, with the
// method each is registered under - the gate lives in better-auth's
// hooks.before now (server/auth.ts), which only runs for RESOLVED endpoints,
// so a wrong-method request is a router 404, not a gate 403. The gate is
// deny-by-default across /passkey/*: anything NOT in auth.ts's
// PASSKEY_UNGATED allowlist - including endpoints a future plugin version
// adds - needs a FRESH session.
const GATED: [string, string][] = [
  ['GET', '/api/auth/passkey/generate-register-options'],
  ['POST', '/api/auth/passkey/verify-registration'],
  ['POST', '/api/auth/passkey/delete-passkey'],
]

async function request(
  method: string,
  path: string,
  cookie: string | null,
  ip = '10.60.0.1',
): Promise<Response> {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    [CSRF_HEADER]: '1',
    'cf-connecting-ip': ip,
  }
  if (cookie) headers.Cookie = cookie
  if (method !== 'GET') headers['Content-Type'] = 'application/json'
  return app.request(
    path,
    {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify({}),
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

    for (const [method, path] of GATED) {
      const res = await request(method, path, cookie)
      expect(res.status, path).toBe(403)
      // better-auth's native dialect now - the client accepts REAUTH_REQUIRED
      // (the old custom middleware's word) AND SESSION_NOT_FRESH
      // (PasskeySection.isReauthRequired), so moving to the native code is
      // invisible to the UI.
      expect(await res.json(), path).toMatchObject({ code: 'SESSION_NOT_FRESH' })
    }
  })

  it('lets a FRESH session through - signing in IS the proof', async () => {
    // No proof to mint, no password to type: the session minted by the sign-in
    // ceremony is itself the fresh-auth proof.
    const { cookie } = await signUpVerifiedUser('fa-fresh@test.dev', '')

    for (const [method, path] of GATED) {
      // better-auth answers on its own terms (empty bodies, so a 4xx from IT
      // is expected) - what matters is that it is not the freshness 403.
      const res = await request(method, path, cookie, '10.60.1.1')
      expect(res.status, path).not.toBe(403)
    }
  })

  it('a fresh ceremony un-stales the user: re-signing in mints a new session', async () => {
    // The recovery path. A stale session cannot be refreshed in place - the
    // user re-authenticates, which creates a NEW session, fresh by
    // construction. Proves the re-auth loop the Settings UI depends on.
    const { cookie: stale } = await signUpVerifiedUser('fa-reauth@test.dev', '')
    await makeSessionStale(stale)
    expect(
      (await request('POST', '/api/auth/passkey/delete-passkey', stale, '10.60.1.2')).status,
    ).toBe(403)

    const { cookie: fresh } = await signInAgain('fa-reauth@test.dev')
    expect(
      (await request('POST', '/api/auth/passkey/delete-passkey', fresh, '10.60.1.3')).status,
    ).not.toBe(403)
  })

  it('leaves the OLD stale session stale after a re-auth elsewhere', async () => {
    // Freshness is per-session, measured from that session's own created_at,
    // so re-authenticating in one place must NOT hand a sensitive-action
    // window to a thief holding a cookie from another.
    const { cookie: stolen } = await signUpVerifiedUser('fa-persession@test.dev', '')
    await makeSessionStale(stolen)

    await signInAgain('fa-persession@test.dev')

    const res = await request('POST', '/api/auth/passkey/delete-passkey', stolen, '10.60.1.4')
    expect(res.status).toBe(403)
  })

  it('401s an anonymous caller on a gated path', async () => {
    const res = await request('POST', '/api/auth/passkey/delete-passkey', null, '10.60.0.3')
    expect(res.status).toBe(401)
    // better-auth's dialect, like the 403 above - NOT the app's {error}
    // shape. These answers ride /api/auth/*, which the SPA reads through
    // better-auth's client: PasskeySection keys off `code`.
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('leaves RENAME ungated even for a stale session', async () => {
    // A rename changes a display label. It cannot add, remove, or alter a
    // credential, so the gate has nothing to protect here and would only cost
    // the owner a ceremony. better-auth will reject this empty body on its
    // own terms - what matters is that the gate did not.
    const { cookie } = await signUpVerifiedUser('fa-rename@test.dev', '')
    await makeSessionStale(cookie)

    const res = await request('POST', '/api/auth/passkey/update-passkey', cookie, '10.60.0.6')
    expect(res.status).not.toBe(403)
  })

  it('leaves the passkey SIGN-IN ceremony and the read ungated', async () => {
    // Gating these would be a self-inflicted outage: the sign-in endpoints
    // are anonymous by definition, and list is a read. Per-endpoint methods
    // and an explicit status-set rejection, because "not 403" alone is a
    // trap: a wrong method 404s and a gate regression 401s, and both would
    // sail past it while passkey sign-in lay broken.
    for (const [method, path] of [
      ['GET', '/api/auth/passkey/generate-authenticate-options'],
      ['POST', '/api/auth/passkey/verify-authentication'],
    ] as const) {
      const res = await request(method, path, null, '10.60.0.4')
      expect(
        [401, 403, 404].includes(res.status),
        `${method} ${path} answered ${res.status} - the ENDPOINT must answer, not a gate or the router`,
      ).toBe(false)
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

  it('an unknown /passkey/* path stays a 404, not a freshness 403', async () => {
    // hooks.before only runs for endpoints the router RESOLVED, so a
    // nonexistent path cannot be turned into a gate answer. Pinned so a
    // better-auth upgrade that changed hook dispatch order goes red here.
    const { cookie } = await signUpVerifiedUser('fa-404@test.dev', '')
    await makeSessionStale(cookie)
    const res = await request('POST', '/api/auth/passkey/no-such-endpoint', cookie, '10.60.0.7')
    expect(res.status).toBe(404)
  })
})
