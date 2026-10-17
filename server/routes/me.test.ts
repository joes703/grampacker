import { env, testDb } from '../test/node-env'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { meResponseSchema } from '../../shared/me'
import { signUpVerifiedUser } from '../test/auth-helpers'

// /api/me is GET-only: grampacker does not collect or store a display name
// (data minimization), so there is nothing to update. The cross-cutting CSRF
// tests live in server/middleware/csrf.test.ts.

describe('/api/me authorization matrix', () => {
  it('anon GET is 401', async () => {
    const res = await app.request('/api/me', {}, env)
    expect(res.status).toBe(401)
  })

  it('owner GET returns own profile shaped by the DTO allowlist', async () => {
    const { cookie } = await signUpVerifiedUser('me-owner@example.com', 'Owner')
    const res = await app.request('/api/me', { headers: { Cookie: cookie } }, env)
    expect(res.status).toBe(200)
    const body = meResponseSchema.parse(await res.json())
    expect(body.email).toBe('me-owner@example.com')
    // Redeeming the magic link IS the proof of the mailbox: better-auth creates
    // the user with emailVerified already true, so there is no separate verify
    // step (and no unverified state for a signed-in user to be stuck in).
    expect(body.emailVerified).toBe(true)
    // The allowlist holds: nothing beyond the DTO's keys leaves the server.
    // No `name` - see the data-minimization note above.
    expect(Object.keys(body).sort()).toEqual(
      ['createdAt', 'email', 'emailVerified', 'id', 'passkeyCount'].sort(),
    )
  })

  it('counts only the caller OWN passkeys', async () => {
    // A count that leaked across accounts would silence the enrollment prompt
    // for exactly the users who most need it - the ones with no passkey.
    const owner = await signUpVerifiedUser('me-haskey@example.com', 'HasKey')
    const other = await signUpVerifiedUser('me-otherkey@example.com', 'Other')

    const ownerId = await testDb.prepare('select id from user where email = ?')
      .bind('me-haskey@example.com')
      .first<{ id: string }>()
    // Passkey rows can only be created by a WebAuthn ceremony, which cannot run
    // in the test app, so the credential is seeded directly. What is under test
    // is the COUNT's scoping, not the ceremony (covered by the passkey tests).
    await testDb.prepare(
      `insert into passkey (id, name, public_key, user_id, credential_id, counter,
         device_type, backed_up, transports, created_at, aaguid)
       values (?, ?, ?, ?, ?, 0, 'singleDevice', 0, 'internal', ?, ?)`,
    )
      .bind(
        'pk-me-1',
        'Test key',
        'pub',
        ownerId?.id ?? '',
        'cred-me-1',
        Date.now(),
        '00000000-0000-0000-0000-000000000000',
      )
      .run()

    const mine = await app.request('/api/me', { headers: { Cookie: owner.cookie } }, env)
    expect(meResponseSchema.parse(await mine.json()).passkeyCount).toBe(1)

    // The other account has only ever used email. Zero is the whole "account
    // not fully set up" signal, and it is DERIVED, not a stored flag: a column
    // would drift the moment a passkey was deleted out-of-band. Zero makes the
    // client prompt for enrollment, and an email-only account is legitimate,
    // so it is a prompt, never a gate.
    const theirs = await app.request('/api/me', { headers: { Cookie: other.cookie } }, env)
    expect(meResponseSchema.parse(await theirs.json()).passkeyCount).toBe(0)
  })

  it('two sessions each see only their own row', async () => {
    const a = await signUpVerifiedUser('me-a@example.com', 'UserA')
    const b = await signUpVerifiedUser('me-b@example.com', 'UserB')
    const resA = await app.request('/api/me', { headers: { Cookie: a.cookie } }, env)
    const resB = await app.request('/api/me', { headers: { Cookie: b.cookie } }, env)
    const bodyA = meResponseSchema.parse(await resA.json())
    const bodyB = meResponseSchema.parse(await resB.json())
    expect(bodyA.email).toBe('me-a@example.com')
    expect(bodyB.email).toBe('me-b@example.com')
    expect(bodyA.id).not.toBe(bodyB.id)
  })

  it('PUT is gone: unsafe methods on /api/me are JSON 404, not the SPA shell', async () => {
    const { cookie } = await signUpVerifiedUser('me-noput@example.com', 'NoPut')
    const res = await app.request(
      '/api/me',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
          'x-grampacker-request': '1',
          Cookie: cookie,
        },
        body: JSON.stringify({ name: 'ghost' }),
      },
      env,
    )
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

describe('user name is never stored', () => {
  it('a magic-link request carrying a name stores an empty string (databaseHooks blanks it)', async () => {
    // The magic-link plugin's body schema accepts an optional `name` and writes
    // it onto the user it creates. grampacker's own client never sends one, but
    // the endpoint is public, so the server cannot rely on that: the
    // databaseHooks guard is the actual defense, and this drives it.
    await signUpVerifiedUser('me-noname@example.com', 'Should Be Dropped')
    const row = await testDb.prepare('select name from user where email = ?')
      .bind('me-noname@example.com')
      .first<{ name: string }>()
    expect(row?.name).toBe('')
  })
})
