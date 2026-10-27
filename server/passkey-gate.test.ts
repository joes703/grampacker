import { app, testDb } from './test/node-env'
import { describe, it, expect } from 'vitest'
import { makeSessionStale, signInAgain, signUpVerifiedUser } from './test/auth-helpers'
import { CSRF_HEADER } from '../shared/api'

// A credential row planted directly, the way auth-delete-user.test.ts seeds
// one: the WebAuthn ceremony cannot run in a test, and the ownership rule on
// rename/delete/list is what is under test, not registration.
async function seedPasskey(email: string, id: string, name: string): Promise<void> {
  const user = await testDb.prepare('select id from user where email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (!user) throw new Error(`no user row for ${email}`)
  await testDb.prepare(
    'insert into passkey (id, name, user_id, public_key, credential_id, counter, device_type, backed_up) values (?, ?, ?, ?, ?, 0, ?, 0)',
  )
    .bind(id, name, user.id, 'pub-key', `cred-${id}`, 'singleDevice')
    .run()
}

async function passkeyRow(id: string): Promise<{ name: string } | null> {
  return testDb.prepare('select name from passkey where id = ?').bind(id).first<{ name: string }>()
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
    'x-forwarded-for': ip,
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

  it('requires a new sign-in to delete a credential and leaves the old session stale', async () => {
    const email = 'fa-reauth@test.dev'
    const { cookie: stale } = await signUpVerifiedUser(email, '')
    await seedPasskey(email, 'reauth-key', 'Laptop')
    await makeSessionStale(stale)
    const remove = (cookie: string) => app.request('/api/auth/passkey/delete-passkey', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json', 'x-forwarded-for': '10.60.1.2' },
      body: JSON.stringify({ id: 'reauth-key' }),
    })
    expect((await remove(stale)).status).toBe(403)
    expect(await passkeyRow('reauth-key')).toEqual({ name: 'Laptop' })
    const { cookie: fresh } = await signInAgain(email)
    expect((await remove(fresh)).status).toBe(200)
    expect(await passkeyRow('reauth-key')).toBeNull()
    expect((await remove(stale)).status).toBe(403)
  })

  it('401s an anonymous caller on a gated path', async () => {
    const res = await request('POST', '/api/auth/passkey/delete-passkey', null, '10.60.0.3')
    expect(res.status).toBe(401)
    // better-auth's dialect, like the 403 above - NOT the app's {error}
    // shape. These answers ride /api/auth/*, which the SPA reads through
    // better-auth's client: PasskeySection keys off `code`.
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' })
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
          'x-forwarded-for': ip,
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify(body),
      },
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
    // The exact refusal and unchanged row prove the mounted access boundary.
    expect(foreignRename.status).toBe(401)
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
          'x-forwarded-for': '10.61.0.6',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: 'pk-owner-1', name: 'Anonymous' }),
      },
    )
    expect(anonRename.status).toBe(401)
    expect(await passkeyRow('pk-owner-1')).toEqual({ name: 'Laptop' })
    const anonList = await app.request(
      '/api/auth/passkey/list-user-passkeys',
      { headers: { Origin: ORIGIN, 'x-forwarded-for': '10.61.0.7' } },
    )
    expect(anonList.status).toBe(401)

    // List: only the caller's credential ids.
    const listed = await app.request(
      '/api/auth/passkey/list-user-passkeys',
      { headers: { Origin: ORIGIN, Cookie: other.cookie, 'x-forwarded-for': '10.61.0.3' } },
    )
    expect(listed.status).toBe(200)
    expect(((await listed.json()) as { id: string }[]).map((p) => p.id)).toEqual(['pk-other-1'])

    // A stale owner can rename and read, but needs a new sign-in to delete.
    await makeSessionStale(owner.cookie)
    const rename = await post(
      owner.cookie,
      '/api/auth/passkey/update-passkey',
      { id: 'pk-owner-1', name: 'Work laptop' },
      '10.61.0.4',
    )
    expect(rename.status).toBe(200)
    expect(await passkeyRow('pk-owner-1')).toEqual({ name: 'Work laptop' })
    const ownList = await app.request('/api/auth/passkey/list-user-passkeys', {
      headers: { Cookie: owner.cookie, Origin: ORIGIN, 'x-forwarded-for': '10.61.0.8' },
    })
    expect(ownList.status).toBe(200)
    expect(((await ownList.json()) as { id: string }[]).map((p) => p.id)).toEqual(['pk-owner-1'])
    const fresh = await signInAgain('pk-owner@test.dev')
    const del = await post(
      fresh.cookie,
      '/api/auth/passkey/delete-passkey',
      { id: 'pk-owner-1' },
      '10.61.0.5',
    )
    expect(del.status).toBe(200)
    expect(await passkeyRow('pk-owner-1')).toBeNull()
    expect(await passkeyRow('pk-other-1')).toEqual({ name: 'Phone' })
  })
})
