import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import app from './index'
import { makeSessionStale, signInAgain, signUpVerifiedUser } from './test/auth-helpers'
import { CSRF_HEADER } from '../shared/api'

// A credential row planted directly, the way auth-delete-user.test.ts seeds
// one: the WebAuthn ceremony cannot run in a test, and the ownership rule on
// rename/delete/list is what is under test, not registration.
async function seedPasskey(email: string, id: string, name: string): Promise<void> {
  const user = await env.DB.prepare('select id from user where email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (!user) throw new Error(`no user row for ${email}`)
  await env.DB.prepare(
    'insert into passkey (id, name, user_id, public_key, credential_id, counter, device_type, backed_up) values (?, ?, ?, ?, ?, 0, ?, 0)',
  )
    .bind(id, name, user.id, 'pub-key', `cred-${id}`, 'singleDevice')
    .run()
}

async function passkeyRow(id: string): Promise<{ name: string } | null> {
  return env.DB.prepare('select name from passkey where id = ?').bind(id).first<{ name: string }>()
}

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
})

// The ownership half of the matrix rows for rename / delete / list. Freshness
// is tested above; this is who may touch WHOSE credential. The plugin scopes
// these by user (requireResourceOwnership in @better-auth/passkey), and this
// pins that the installed version still does - a regression here is another
// account deleting or relabeling someone's sign-in credential.
describe('passkey rename / delete / list are scoped to the owner', () => {
  async function post(cookie: string, path: string, body: unknown, ip: string) {
    return app.request(
      path,
      {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          [CSRF_HEADER]: '1',
          'cf-connecting-ip': ip,
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify(body),
      },
      env,
    )
  }

  it('the owner can rename and delete, a non-owner can do neither, and list shows only your own', async () => {
    const owner = await signUpVerifiedUser('pk-owner@test.dev', '')
    const other = await signUpVerifiedUser('pk-other@test.dev', '')
    await seedPasskey('pk-owner@test.dev', 'pk-owner-1', 'Laptop')
    await seedPasskey('pk-other@test.dev', 'pk-other-1', 'Phone')

    // Non-owner rename: refused, label untouched.
    const foreignRename = await post(
      other.cookie,
      '/api/auth/passkey/update-passkey',
      { id: 'pk-owner-1', name: 'Hijacked' },
      '10.61.0.1',
    )
    // Pinned to the plugin's ownership refusal (requireResourceOwnership with
    // forbiddenStatus UNAUTHORIZED), not merely "not ok": a 400 from a body
    // mismatch, a 404 or a 429 would all leave the row untouched without
    // ever reaching the ownership check.
    expect(foreignRename.status).toBe(401)
    expect(await foreignRename.json()).toMatchObject({
      code: 'YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY',
    })
    expect(await passkeyRow('pk-owner-1')).toEqual({ name: 'Laptop' })

    // Non-owner delete (fresh session, so the freshness gate is not what
    // refuses it): refused, row still there.
    const foreignDelete = await post(
      other.cookie,
      '/api/auth/passkey/delete-passkey',
      { id: 'pk-owner-1' },
      '10.61.0.2',
    )
    expect(foreignDelete.status).toBe(401)
    expect(await passkeyRow('pk-owner-1')).toEqual({ name: 'Laptop' })

    // Anonymous rename and list: the matrix's third caller, for the two
    // endpoints the freshness tests above do not cover anonymously.
    const anonRename = await app.request(
      '/api/auth/passkey/update-passkey',
      {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          [CSRF_HEADER]: '1',
          'cf-connecting-ip': '10.61.0.6',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: 'pk-owner-1', name: 'Anonymous' }),
      },
      env,
    )
    expect(anonRename.status).toBe(401)
    expect(await passkeyRow('pk-owner-1')).toEqual({ name: 'Laptop' })
    const anonList = await app.request(
      '/api/auth/passkey/list-user-passkeys',
      { headers: { Origin: ORIGIN, 'cf-connecting-ip': '10.61.0.7' } },
      env,
    )
    expect(anonList.status).toBe(401)

    // List: only the caller's credential ids.
    const listed = await app.request(
      '/api/auth/passkey/list-user-passkeys',
      { headers: { Origin: ORIGIN, Cookie: other.cookie, 'cf-connecting-ip': '10.61.0.3' } },
      env,
    )
    expect(listed.status).toBe(200)
    expect(((await listed.json()) as { id: string }[]).map((p) => p.id)).toEqual(['pk-other-1'])

    // Owner rename and delete work, and touch only the named row.
    const rename = await post(
      owner.cookie,
      '/api/auth/passkey/update-passkey',
      { id: 'pk-owner-1', name: 'Work laptop' },
      '10.61.0.4',
    )
    expect(rename.status).toBe(200)
    expect(await passkeyRow('pk-owner-1')).toEqual({ name: 'Work laptop' })
    const del = await post(
      owner.cookie,
      '/api/auth/passkey/delete-passkey',
      { id: 'pk-owner-1' },
      '10.61.0.5',
    )
    expect(del.status).toBe(200)
    expect(await passkeyRow('pk-owner-1')).toBeNull()
    expect(await passkeyRow('pk-other-1')).toEqual({ name: 'Phone' })
  })
})
