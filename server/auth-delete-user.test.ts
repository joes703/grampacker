import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeSessionStale, signUpVerifiedUser } from './test/auth-helpers'
import { apiRequest } from './test/api-helpers'

// Delete-account is destructive and total: better-auth's internalAdapter
// deleteUser removes only the session/account/user rows itself - the user's
// ACTUAL data (passkey, categories, gear_items, lists, list_items) is wiped
// solely by the ON DELETE CASCADE off user.id. This suite is the proof that
// the cascade fires end to end, including the one path production has never
// exercised: gear_items -> categories is a NO ACTION composite FK, so when
// the user row is deleted, categories and gear_items are cascade-deleted in
// the same statement and the check must resolve at statement end (not
// mid-statement, which RESTRICT would do). If FK enforcement were off, the
// endpoint would 200 while silently orphaning every gear/list row - the
// opposite of what "delete my account" promises.
//
// Scope note: the erasure guarantee covers the account, its credentials
// (session/account/passkey), ALL user content (categories/gear_items/lists/
// list_items), AND the account's lingering auth artifacts in better-auth's
// `verification` table. That table is keyed by identifier/value, not user_id,
// so the FK cascade never reaches it; two row shapes grampacker writes embed
// the user id and would otherwise outlive the deleted account until they
// expire - password-reset tokens (`value = user.id`) and passkey ceremony
// challenges (`value` JSON, `$.userData.id = user.id`). The
// deleteUser.beforeDelete hook (server/auth.ts -> usersRepo
// .purgeVerificationArtifacts) deletes every verification row pointing at the
// user, both shapes, before the irreversible user delete - proven below.
// `rate_limits` is keyed by client IP+scope, not the user, so it stays out of
// scope.
//
// The authorization gate is FRESHNESS, not a password: with no password in the
// body, better-auth's delete-user requires a session created within freshAge and
// answers 400 SESSION_EXPIRED otherwise. Both arms are covered below.

const APP_TABLES = ['categories', 'gear_items', 'lists', 'list_items', 'passkey'] as const
// `account` is deliberately absent: passwordless users have NO account row.
// better-auth only writes one for a credential (password) or an OAuth provider,
// and magic-link sign-in creates neither. Asserting it drops to zero would be
// asserting nothing.
const AUTH_CHILD_TABLES = ['session'] as const

async function userIdOf(email: string): Promise<string> {
  const row = await env.DB.prepare('select id from user where email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (!row) throw new Error(`no user row for ${email}`)
  return row.id
}

async function rowCounts(userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const table of [...APP_TABLES, ...AUTH_CHILD_TABLES]) {
    const r = await env.DB.prepare(`select count(*) as n from ${table} where user_id = ?`)
      .bind(userId)
      .first<{ n: number }>()
    out[table] = r?.n ?? -1
  }
  const u = await env.DB.prepare('select count(*) as n from user where id = ?')
    .bind(userId)
    .first<{ n: number }>()
  out.user = u?.n ?? -1
  return out
}

// Seed one row in every user-owned table, wired the way the app wires them:
// gear references a category (exercising the NO ACTION composite FK), and a
// list_item references BOTH that list and that gear (its own cascading
// composite FKs). All ids derive from the unique userId, and the list slug
// is a fresh random 6-char value, so two seeded users - and repeated test
// runs against persisted storage - never collide (lists.slug is UNIQUE).
async function seedUserData(userId: string): Promise<void> {
  const now = Date.now()
  const catId = `${userId}-cat`
  const gearId = `${userId}-gear`
  const listId = `${userId}-list`
  const slug = crypto.randomUUID().replace(/-/g, '').slice(0, 6)
  await env.DB.batch([
    env.DB.prepare(
      'insert into categories (id, user_id, name, sort_order, created_at) values (?, ?, ?, 0, ?)',
    ).bind(catId, userId, 'Shelter', now),
    env.DB.prepare(
      'insert into gear_items (id, user_id, category_id, name, weight_grams, status, sort_order, created_at, updated_at) values (?, ?, ?, ?, 100, ?, 0, ?, ?)',
    ).bind(gearId, userId, catId, 'Tent', 'active', now, now),
    env.DB.prepare(
      'insert into lists (id, user_id, name, slug, sort_order, created_at, updated_at) values (?, ?, ?, ?, 0, ?, ?)',
    ).bind(listId, userId, 'Overnighter', slug, now, now),
    env.DB.prepare(
      'insert into list_items (id, user_id, list_id, gear_item_id, quantity, sort_order, created_at, updated_at) values (?, ?, ?, ?, 1, 0, ?, ?)',
    ).bind(`${userId}-li`, userId, listId, gearId, now, now),
    env.DB.prepare(
      'insert into passkey (id, user_id, public_key, credential_id, counter, device_type, backed_up) values (?, ?, ?, ?, 0, ?, 0)',
    ).bind(`${userId}-pk`, userId, 'pub-key', `${userId}-cred`, 'singleDevice'),
  ])
}

// better-auth's `verification` table has no user_id column, so the FK cascade
// cannot reach it - only the beforeDelete purge does. Two row shapes grampacker
// writes must be cleaned, and they are found by DIFFERENT predicates. expires_at
// is required (no default); created_at/updated_at have SQL defaults.

// passkey generate-register-options write: `value` is JSON ceremony state whose
// `$.userData.id` is the user id (see @better-auth/passkey).
async function seedPasskeyChallenge(userId: string): Promise<void> {
  const token = crypto.randomUUID().replace(/-/g, '')
  const value = JSON.stringify({
    type: 'registration',
    expectedChallenge: 'test-challenge',
    userData: { id: userId, name: '', displayName: '' },
    context: null,
  })
  await env.DB.prepare(
    'insert into verification (id, identifier, value, expires_at) values (?, ?, ?, ?)',
  )
    .bind(`${userId}-pkver`, token, value, Date.now() + 300_000)
    .run()
}

// A PENDING MAGIC LINK: `value` is JSON carrying `$.email` and NO user id at
// all. This is the shape that would survive a user-id-keyed purge - and it is
// not inert. Redeeming it after the delete would sign the address straight back
// up (magic-link verify creates the user when none matches), so the account the
// owner just deleted would reappear on their next stale click.
async function seedPendingMagicLink(email: string): Promise<void> {
  const token = crypto.randomUUID().replace(/-/g, '')
  await env.DB.prepare(
    'insert into verification (id, identifier, value, expires_at) values (?, ?, ?, ?)',
  )
    .bind(
      `ml-${token}`,
      token,
      JSON.stringify({ email, name: '' }),
      Date.now() + 300_000,
    )
    .run()
}

// Count every verification artifact attributable to a user, matching the purge's
// own predicate (passkey ceremony by user id, pending magic link by email).
async function verificationCount(userId: string, email: string): Promise<number> {
  const r = await env.DB.prepare(
    `select count(*) as n from verification
     where (json_valid(value) and json_extract(value, '$.userData.id') = ?)
        or (json_valid(value) and json_extract(value, '$.email') = ?)`,
  )
    .bind(userId, email)
    .first<{ n: number }>()
  return r?.n ?? -1
}

// No password: its ABSENCE is what selects better-auth's freshness path.
async function deleteAccount(cookie: string | null): Promise<Response> {
  return apiRequest(cookie, 'POST', '/api/auth/delete-user', {})
}

describe('POST /api/auth/delete-user', () => {
  let email: string
  let cookie: string
  let userId: string
  // A bystander whose identical data must be untouched by the deletion.
  let otherEmail: string
  let otherId: string

  beforeEach(async () => {
    // /api/auth/delete-user now has its own tight 5/10min rate bucket
    // (server/middleware/rate-limit.ts). apiRequest sends no cf-connecting-ip,
    // so every delete-user call here shares the 'local' bucket; across this
    // file's tests that exceeds 5 and a later test would see 429 instead of the
    // status it asserts. These tests are about deletion semantics, not rate
    // limiting, so reset the limiter before each so each starts with a full
    // budget (every test makes at most two delete-user calls).
    await env.DB.prepare('delete from rate_limits').run()

    email = `del-${crypto.randomUUID()}@example.com`
    otherEmail = `keep-${crypto.randomUUID()}@example.com`
    ;({ cookie } = await signUpVerifiedUser(email, 'Doomed'))
    await signUpVerifiedUser(otherEmail, 'Bystander')
    userId = await userIdOf(email)
    otherId = await userIdOf(otherEmail)
    await seedUserData(userId)
    await seedUserData(otherId)
    // Both users have both verification artifact shapes outstanding: a passkey
    // challenge (found by user id) and a pending magic link (found by email).
    await seedPasskeyChallenge(userId)
    await seedPasskeyChallenge(otherId)
    await seedPendingMagicLink(email)
    await seedPendingMagicLink(otherEmail)
  })

  it('on a FRESH session wipes the user and cascades away ALL their data', async () => {
    // Precondition: everything is actually seeded (a 200 over empty tables
    // would falsely pass).
    const before = await rowCounts(userId)
    for (const table of [...APP_TABLES, ...AUTH_CHILD_TABLES]) {
      expect(before[table], `seeded ${table}`).toBeGreaterThan(0)
    }
    expect(before.user).toBe(1)

    expect(await verificationCount(userId, email), 'seeded verification artifacts').toBe(2)

    const res = await deleteAccount(cookie)
    expect(res.status).toBe(200)

    const after = await rowCounts(userId)
    for (const table of [...APP_TABLES, ...AUTH_CHILD_TABLES]) {
      expect(after[table], `${table} after delete`).toBe(0)
    }
    expect(after.user, 'user row after delete').toBe(0)
    // The beforeDelete hook purges the account's lingering verification
    // artifacts, which the FK cascade cannot reach (verification has no
    // user_id). The pending magic link is the load-bearing one: left behind, it
    // would sign the address straight back up on the next click.
    expect(await verificationCount(userId, email), 'verification artifacts after delete').toBe(0)
  })

  it('leaves every other user completely intact (blast radius is one account)', async () => {
    const otherBefore = await rowCounts(otherId)
    const res = await deleteAccount(cookie)
    expect(res.status).toBe(200)
    const otherAfter = await rowCounts(otherId)
    expect(otherAfter).toEqual(otherBefore)
    expect(otherAfter.user).toBe(1)
    // The purge is scoped to the deleted user's id AND email, so the bystander's
    // outstanding artifacts (passkey challenge + pending magic link) survive.
    expect(
      await verificationCount(otherId, otherEmail),
      "bystander's verification artifacts",
    ).toBe(2)
  })

  it('rejects a STALE session and deletes nothing', async () => {
    // The gate that replaces the password prompt. A session older than freshAge
    // cannot delete the account, so a stolen long-lived cookie is not enough -
    // the attacker would have to pass a passkey ceremony (or the mailbox).
    await makeSessionStale(cookie)

    const res = await deleteAccount(cookie)
    expect(res.ok).toBe(false)
    expect(((await res.json()) as { code?: string }).code).toBe('SESSION_EXPIRED')

    const after = await rowCounts(userId)
    expect(after.user).toBe(1)
    for (const table of APP_TABLES) {
      expect(after[table], `${table} still present`).toBeGreaterThan(0)
    }
  })

  it('rejects an anonymous request and deletes nothing', async () => {
    const res = await deleteAccount(null)
    expect(res.ok).toBe(false)
    expect([400, 401]).toContain(res.status)
    const after = await rowCounts(userId)
    expect(after.user).toBe(1)
  })

  it('refuses to resurrect a password: a supplied password is rejected, not honored', async () => {
    // There is no credential account any more, so better-auth's password path
    // 400s with CREDENTIAL_ACCOUNT_NOT_FOUND rather than falling back to the
    // freshness check. Worth pinning: it means a stale client still sending a
    // password gets a clean refusal instead of silently deleting the account by
    // the other route.
    const res = await apiRequest(cookie, 'POST', '/api/auth/delete-user', {
      password: 'anything-at-all-123456',
    })
    expect(res.ok).toBe(false)
    expect(((await res.json()) as { code?: string }).code).toBe(
      'CREDENTIAL_ACCOUNT_NOT_FOUND',
    )

    const after = await rowCounts(userId)
    expect(after.user).toBe(1)
  })
})
