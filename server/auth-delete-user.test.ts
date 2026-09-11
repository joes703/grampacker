import { env } from 'cloudflare:test'
import { hashPassword } from 'better-auth/crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeSessionStale, signUpVerifiedUser } from './test/auth-helpers'
import { apiRequest } from './test/api-helpers'
import app from './index'
import { lastEmailTo } from './email/console'
import { MAGIC_LINK_PATH } from '../shared/auth'

// The namespace better-auth 1.7 stores in `account.issuer` for a credential
// account: `createLocalAccountIssuer('credential')` in @better-auth/core,
// which is neither a direct dependency nor re-exported by better-auth, hence
// the literal. The test below is what proves it is the value the runtime
// actually looks up.
const CREDENTIAL_ACCOUNT_ISSUER = 'local:credential'

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

// The token out of the console outbox, the way auth-helpers reads it: the
// link points at the SPA with the token in the fragment.
function tokenFromEmailTo(to: string): string {
  const msg = lastEmailTo(to)
  if (!msg) throw new Error(`no magic-link email was sent to ${to}`)
  const token = msg.text.match(new RegExp(`${MAGIC_LINK_PATH}#token=([^\\s]+)`))?.[1]
  if (!token) throw new Error(`magic-link email to ${to} carried no token`)
  return decodeURIComponent(token)
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

  it('deletes an account whose list has a bagged item colliding on pack rank (P0.1)', async () => {
    // The account-delete arm of P0.1, one cascade level deeper than the list
    // arm: user -> lists -> packing_locations, whose SET NULL then drops bagged
    // items into Unassigned carrying their old ranks. Before migration 0020
    // this failed with
    //   UNIQUE constraint failed: list_items.list_id, list_items.pack_sort_order
    // and the account could not be deleted at all.
    const listRes = await apiRequest(cookie, 'POST', '/api/lists', { name: 'Trip' })
    expect(listRes.status).toBe(201)
    const listId = ((await listRes.json()) as { id: string }).id

    const gear = async (name: string) => {
      const r = await apiRequest(cookie, 'POST', '/api/gear-items', { name })
      expect(r.status).toBe(201)
      return ((await r.json()) as { id: string }).id
    }
    const addItem = async (gearItemId: string) => {
      const r = await apiRequest(cookie, 'POST', `/api/lists/${listId}/items`, {
        gearItemId,
      })
      expect(r.status).toBe(201)
      return (await r.json()) as { id: string; packSortOrder: number }
    }

    const loose = await addItem(await gear('Loose'))
    const locRes = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${listId}/packing-locations`,
      { name: 'Bag' },
    )
    expect(locRes.status).toBe(201)
    const locationId = ((await locRes.json()) as { id: string }).id
    const bagged = await addItem(await gear('Bagged'))
    expect(
      (
        await apiRequest(cookie, 'PATCH', `/api/lists/${listId}/items/${bagged.id}`, {
          packingLocationId: locationId,
        })
      ).status,
    ).toBe(200)

    // Assert the colliding shape exists, so this cannot pass vacuously.
    const items = (await (
      await apiRequest(cookie, 'GET', `/api/lists/${listId}/items`)
    ).json()) as { id: string; packSortOrder: number }[]
    expect(items.find((i) => i.id === loose.id)?.packSortOrder).toBe(
      items.find((i) => i.id === bagged.id)?.packSortOrder,
    )

    expect((await deleteAccount(cookie)).status).toBe(200)
    const left = await env.DB.prepare(
      'select count(*) as n from list_items where user_id = ?',
    )
      .bind(userId)
      .first<{ n: number }>()
    expect(left?.n).toBe(0)
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

  it('purges a pending magic link requested in a different letter case', async () => {
    // The plugin stores the address AS SUBMITTED in the verification row and
    // lowercases it only when it looks the user up (better-auth's z.email()
    // does not fold case). The user row is lowercase, so a purge comparing the
    // stored JSON email to the user's email byte-for-byte missed a link
    // requested as `Alice@Example.com` for the account `alice@example.com` -
    // and redeeming that survivor after the delete signed the address straight
    // back up. This drives the whole path over HTTP and checks the OUTCOME (no
    // user row, token refused), never the purge's own predicate.
    const mixedCase = email.replace('del-', 'DEL-').replace('@example.com', '@Example.COM')
    expect(mixedCase).not.toBe(email)
    expect(mixedCase.toLowerCase()).toBe(email)

    // A bystander whose address is similar but NOT the same identity must keep
    // its pending link: the purge has to be case-insensitive, not broad.
    const similar = email.replace('@', '+keep@')
    for (const to of [mixedCase, similar]) {
      const send = await app.request(
        '/api/auth/sign-in/magic-link',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173',
            'cf-connecting-ip': '10.88.0.1',
          },
          body: JSON.stringify({ email: to }),
        },
        env,
      )
      expect(send.status, `magic-link request for ${to}`).toBe(200)
    }
    const stolenToken = tokenFromEmailTo(mixedCase)
    const bystanderToken = tokenFromEmailTo(similar)

    expect((await deleteAccount(cookie)).status).toBe(200)

    const redeem = (token: string) =>
      app.request(
        `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
        { headers: { Origin: 'http://localhost:5173', 'cf-connecting-ip': '10.88.0.2' } },
        env,
      )

    // The plugin answers a bad token with a redirect carrying INVALID_TOKEN
    // (and a good one with JSON + Set-Cookie). Asserting the specific
    // refusal keeps a 429 or a 500 from passing as "refused".
    const stale = await redeem(stolenToken)
    expect(stale.status).toBe(302)
    expect(stale.headers.get('location')).toContain('error=INVALID_TOKEN')
    expect(stale.headers.get('set-cookie')).toBeNull()
    const resurrected = await env.DB.prepare(
      'select count(*) as n from user where lower(email) = lower(?)',
    )
      .bind(email)
      .first<{ n: number }>()
    expect(resurrected?.n, 'user rows for the deleted address').toBe(0)

    // The similar address is a different account and its link still works.
    const kept = await redeem(bystanderToken)
    expect(kept.status).toBe(200)
    expect(kept.headers.get('set-cookie')).toContain('session_token')
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

  it("a credential row stored under the migration's namespace is the one 1.7 looks up", async () => {
    // The refusal above is only meaningful if the lookup that produced it
    // is the real one. better-auth 1.7 keys a credential account by ALL of
    // user_id, provider_id, issuer and account_id (migration 0028 added the
    // column). This proves CREDENTIAL_ACCOUNT_ISSUER is the namespace the
    // runtime actually queries and that the column is live end to end:
    // plant a credential row under it, send the WRONG password, and the
    // only way to reach INVALID_PASSWORD is for findCredentialAccount to
    // have matched the row. A stale namespace would surface as
    // CREDENTIAL_ACCOUNT_NOT_FOUND instead. No account is deleted either
    // way - a wrong password is a refusal, and that is asserted too.
    await env.DB.prepare(
      'insert into account (id, issuer, account_id, provider_id, user_id, password, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        `${userId}-cred`,
        CREDENTIAL_ACCOUNT_ISSUER,
        userId,
        'credential',
        userId,
        await hashPassword('the-real-password-123456'),
        Date.now(),
      )
      .run()

    const res = await apiRequest(cookie, 'POST', '/api/auth/delete-user', {
      password: 'not-the-real-password',
    })
    expect(res.ok).toBe(false)
    expect(((await res.json()) as { code?: string }).code).toBe('INVALID_PASSWORD')

    const after = await rowCounts(userId)
    expect(after.user).toBe(1)
    for (const table of APP_TABLES) {
      expect(after[table], `${table} still present`).toBeGreaterThan(0)
    }
    // rowCounts() deliberately leaves `account` out (passwordless users have
    // none), so the planted row's survival is asserted directly: a refused
    // password must not consume the credential either.
    const credential = await env.DB.prepare(
      'select count(*) as n from account where user_id = ? and provider_id = ?',
    )
      .bind(userId, 'credential')
      .first<{ n: number }>()
    expect(credential?.n).toBe(1)
  })
})
