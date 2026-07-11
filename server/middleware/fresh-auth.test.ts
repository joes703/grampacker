import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import app from '../index'
import { signUpVerifiedUser, TEST_PASSWORD } from '../test/auth-helpers'
import { CSRF_HEADER } from '../../shared/api'

const ORIGIN = 'http://localhost:5173'

// The four passkey endpoints that MUTATE the credential set. If the plugin
// ever grows a fifth, this list and server/middleware/fresh-auth.ts must both
// learn about it - an ungated mutation endpoint makes the gate theater.
const GATED = [
  '/api/auth/passkey/generate-register-options',
  '/api/auth/passkey/verify-registration',
  '/api/auth/passkey/delete-passkey',
  '/api/auth/passkey/update-passkey',
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

async function grantProof(cookie: string, ip = '10.60.0.2'): Promise<void> {
  const res = await app.request(
    '/api/me/reauth',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        [CSRF_HEADER]: '1',
        'cf-connecting-ip': ip,
        Cookie: cookie,
      },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    },
    env,
  )
  if (res.status !== 204) throw new Error(`reauth failed: ${res.status}`)
}

describe('passkey fresh-auth gate', () => {
  it('403s every passkey mutation when the session has no proof', async () => {
    // The whole point: a valid session is NOT enough to plant or drop a
    // credential. Before this gate, each of these went straight through.
    const { cookie } = await signUpVerifiedUser('fa-gate@test.dev', '')
    for (const path of GATED) {
      const res = await post(path, cookie)
      expect(res.status, path).toBe(403)
      expect(await res.json(), path).toMatchObject({ code: 'REAUTH_REQUIRED' })
    }
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
  })

  it('stops 403ing once a proof exists', async () => {
    const { cookie } = await signUpVerifiedUser('fa-pass@test.dev', '')
    expect((await post(GATED[0]!, cookie)).status).toBe(403)

    await grantProof(cookie)

    // Past the gate now. better-auth answers on its own terms (these bodies
    // are empty, so a 4xx from IT is expected) - what matters is that it is
    // no longer OUR 403.
    const res = await post(GATED[0]!, cookie)
    expect(res.status).not.toBe(403)
  })

  it('leaves the passkey SIGN-IN ceremony and the read ungated', async () => {
    // Gating these would be a self-inflicted outage: the sign-in endpoints are
    // anonymous by definition (you cannot prove a password with a session you
    // do not have yet), and list is a read.
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

  it('drops the proof when the session goes away (sign-out)', async () => {
    // The FK cascade from session is what makes the proof unable to outlive
    // the session that earned it.
    const { cookie } = await signUpVerifiedUser('fa-signout@test.dev', '')
    await grantProof(cookie, '10.60.0.6')
    const before = await env.DB.prepare(
      'select count(*) as n from fresh_auth where user_id = (select id from user where email = ?)',
    )
      .bind('fa-signout@test.dev')
      .first<{ n: number }>()
    expect(before?.n).toBe(1)

    const out = await app.request(
      '/api/auth/sign-out',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          [CSRF_HEADER]: '1',
          'cf-connecting-ip': '10.60.0.6',
          Cookie: cookie,
        },
        body: JSON.stringify({}),
      },
      env,
    )
    expect(out.ok).toBe(true)

    const after = await env.DB.prepare(
      'select count(*) as n from fresh_auth where user_id = (select id from user where email = ?)',
    )
      .bind('fa-signout@test.dev')
      .first<{ n: number }>()
    expect(after?.n).toBe(0)
  })

  it('refuses a proof that predates the password, even if the purge never ran', async () => {
    // Fail-closed check. The purge in server/index.ts is a separate write
    // AFTER better-auth changed the password - if it failed, a proof minted
    // with the OLD password would still be sitting there. Simulate exactly
    // that by changing the password and then re-inserting the stale proof
    // behind the app's back. The gate must still refuse it, because
    // granted_at now precedes the credential account's updated_at.
    const { cookie } = await signUpVerifiedUser('fa-failclosed@test.dev', '')
    await grantProof(cookie, '10.60.0.8')

    const changed = await app.request(
      '/api/auth/change-password',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          [CSRF_HEADER]: '1',
          'cf-connecting-ip': '10.60.0.8',
          Cookie: cookie,
        },
        body: JSON.stringify({
          currentPassword: TEST_PASSWORD,
          newPassword: 'another-long-password-789',
        }),
      },
      env,
    )
    expect(changed.status).toBe(200)

    // Re-plant the stale proof the purge would have removed: unexpired, but
    // granted before the password changed.
    const ids = await env.DB.prepare(
      'select s.id as sid, s.user_id as uid from session s join user u on u.id = s.user_id where u.email = ?',
    )
      .bind('fa-failclosed@test.dev')
      .first<{ sid: string; uid: string }>()
    const now = Date.now()
    await env.DB.prepare(
      'insert or replace into fresh_auth (session_id, user_id, expires_at, granted_at) values (?, ?, ?, ?)',
    )
      .bind(ids!.sid, ids!.uid, now + 600_000, now - 600_000)
      .run()

    const res = await post(GATED[2]!, cookie, '10.60.0.8')
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'REAUTH_REQUIRED' })
  })

  it('drops the proof on a password change', async () => {
    // Cascades do NOT cover this one: a password change leaves the session
    // alive, so a proof earned with the OLD password would otherwise survive
    // it. server/index.ts purges explicitly.
    const { cookie } = await signUpVerifiedUser('fa-changepw@test.dev', '')
    await grantProof(cookie, '10.60.0.7')

    const changed = await app.request(
      '/api/auth/change-password',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          [CSRF_HEADER]: '1',
          'cf-connecting-ip': '10.60.0.7',
          Cookie: cookie,
        },
        body: JSON.stringify({
          currentPassword: TEST_PASSWORD,
          newPassword: 'a-different-long-password-456',
        }),
      },
      env,
    )
    expect(changed.status).toBe(200)

    const after = await env.DB.prepare(
      'select count(*) as n from fresh_auth where user_id = (select id from user where email = ?)',
    )
      .bind('fa-changepw@test.dev')
      .first<{ n: number }>()
    expect(after?.n).toBe(0)
  })
})
