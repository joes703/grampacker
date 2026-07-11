import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { signUpVerifiedUser } from './test/auth-helpers'
import { apiRequest } from './test/api-helpers'

// A password reset must revoke every existing session for that user
// (server/auth.ts -> emailAndPassword.revokeSessionsOnPasswordReset). Sessions
// are 30-day sliding, so a reset that left old sessions live would let a
// stolen session cookie survive the very reset meant to lock the thief out.
// better-auth only deletes sessions on reset when the flag is set (verified in
// node_modules/better-auth/.../routes/password.mjs: the reset-password route
// calls deleteUserSessions(userId) guarded on revokeSessionsOnPasswordReset).

async function userIdOf(email: string): Promise<string> {
  const row = await env.DB.prepare('select id from user where email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (!row) throw new Error(`no user row for ${email}`)
  return row.id
}

async function sessionCount(userId: string): Promise<number> {
  const r = await env.DB.prepare('select count(*) as n from session where user_id = ?')
    .bind(userId)
    .first<{ n: number }>()
  return r?.n ?? -1
}

// Seed a reset token exactly as requestPasswordReset does: identifier
// `reset-password:<token>`, value = user id (the reset-password route reads the
// user id back out of the verification row). This is the same seeding shape the
// delete-account suite uses, and it lets the test drive the real reset-password
// endpoint without standing up email delivery.
async function seedResetToken(userId: string): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, '')
  await env.DB.prepare(
    'insert into verification (id, identifier, value, expires_at) values (?, ?, ?, ?)',
  )
    .bind(`${userId}-reset`, `reset-password:${token}`, userId, Date.now() + 3_600_000)
    .run()
  return token
}

describe('password reset revokes existing sessions', () => {
  it('kills a live session cookie after a successful reset', async () => {
    const email = `reset-${crypto.randomUUID()}@example.com`
    const { cookie } = await signUpVerifiedUser(email, 'Resetter')
    const userId = await userIdOf(email)

    // Precondition: the freshly-signed-in cookie authenticates, and exactly one
    // session row exists (a false pass otherwise if the cookie never worked).
    const before = await apiRequest(cookie, 'GET', '/api/auth/get-session')
    expect(before.status).toBe(200)
    const beforeBody = (await before.json()) as { user?: { id: string } } | null
    expect(beforeBody?.user?.id).toBe(userId)
    expect(await sessionCount(userId)).toBe(1)

    // Reset the password through the real endpoint (token seeded as email would
    // have delivered it). New password clears the 12-char minimum.
    const token = await seedResetToken(userId)
    const reset = await apiRequest(null, 'POST', '/api/auth/reset-password', {
      newPassword: 'a-different-long-password-456',
      token,
    })
    expect(reset.ok, `reset-password should succeed, got ${reset.status}`).toBe(true)

    // The pre-reset session cookie no longer authenticates: get-session returns
    // a null session, and the session row is gone from D1.
    const after = await apiRequest(cookie, 'GET', '/api/auth/get-session')
    const afterBody = (await after.json()) as { user?: unknown } | null
    expect(afterBody?.user ?? null).toBeNull()
    expect(await sessionCount(userId)).toBe(0)
  })
})
