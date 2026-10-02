import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from './index'
import { signUpVerifiedUser } from './test/auth-helpers'
import { CSRF_HEADER } from './middleware/csrf'
import { DELETE_ACCOUNT_USER_HEADER } from '../shared/auth'

// `account.issuer` is gone, asserted ON THE WIRE.
//
// Migration 0028 added that column NOT NULL with a unique index for
// better-auth 1.7.0-1.7.2. 1.7.3 reverted it and turned schema validation on
// by default, so from 1.7.4 the validator rejected it before every
// /api/auth/* dispatch. #241 stopped the adapter reading it (an issuer-free
// model while the column stayed); 0029 dropped the column one release later,
// which is the gap deploy.yml's migrate-then-swap ordering requires.
//
// Why this outlived the two-model wiring it was written for: the schema files
// no longer mention `issuer`, but the SQL is what actually reaches D1, and
// `db.select()` with no projection expands EVERY column of whatever model the
// adapter resolved. A regenerated schema, a hand-edit, or a revived migration
// putting the column back would show up here as different SQL and nowhere
// else - the physical table would accept it and every test asserting on rows
// would stay green.

const ORIGIN = 'http://localhost:5173'

// The real D1 binding with `prepare` instrumented: every statement's SQL is
// appended to `seen` and the REAL prepared statement is returned, so the
// request runs normally and the assertions happen afterwards. Same shape as
// the sabotage proxy in auth-error-logging.test.ts, minus the sabotage.
function recordingD1(seen: string[]): D1Database {
  return new Proxy(env.DB, {
    get(db, prop) {
      if (prop !== 'prepare') {
        const value = Reflect.get(db, prop, db)
        return typeof value === 'function' ? value.bind(db) : value
      }
      return (query: string) => {
        seen.push(query)
        return db.prepare(query)
      }
    },
  })
}

describe('the account model better-auth actually queries', () => {
  // Deleting a user is the path that reads `account` without being asked to:
  // internalAdapter.deleteUser calls deleteManyWithHooks(..., 'account'), which
  // runs an unconditional findMany BEFORE consulting hooks
  // (better-auth/dist/db/internal-adapter.mjs:232, db/with-hooks.mjs:157). That
  // findMany takes no `select`, so the adapter emits `db.select()` over every
  // column of the resolved model - which is what makes it the sharpest probe of
  // which model the adapter resolved.
  //
  // The lookup is wrapped in `try {} catch {}`, and the catch swallows ONLY the
  // lookup: `adapter.deleteMany` still runs (with-hooks.mjs:173) and deleteUser
  // proceeds. So a broken read does NOT show up as a failed deletion - the
  // request would answer 200 with the user genuinely gone, having silently
  // skipped every account-row delete hook. There is no observable symptom at
  // the HTTP layer at all. That is precisely why this is asserted in SQL.
  //
  // What this proves: the deletion path exercised here emits no statement
  // naming the column. It does NOT prove that of every account query, of the
  // relational (`db.query`) path, or of any RETURNING clause. The credential
  // lookup in auth-delete-user.test.ts stays as separate coverage.
  it('never names issuer in the SQL a user deletion emits', async () => {
    const email = `acct-sql-${crypto.randomUUID()}@example.com`
    const { cookie } = await signUpVerifiedUser(email, '')

    const before = await env.DB.prepare('select id from user where email = ?')
      .bind(email)
      .first<{ id: string }>()
    expect(before?.id).toBeTruthy()
    const userId = before!.id

    // Recording starts here, so sign-up's own statements are not in scope.
    const seen: string[] = []
    const res = await app.request(
      '/api/auth/delete-user',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: ORIGIN,
          'Content-Type': 'application/json',
          [CSRF_HEADER]: '1',
          [DELETE_ACCOUNT_USER_HEADER]: userId,
          'cf-connecting-ip': '10.55.0.1',
        },
        body: JSON.stringify({}),
      },
      { ...env, DB: recordingD1(seen) },
    )
    expect(res.status, await res.text()).toBe(200)

    // The recorder saw the request at all. Without this a proxy that silently
    // stopped intercepting would make the issuer assertion below vacuous.
    expect(seen.length).toBeGreaterThan(0)

    // The account read really happened - otherwise "no statement names issuer"
    // would be true for the boring reason that nothing queried `account`.
    const accountReads = seen.filter(
      (q) => /\bfrom\s+("account"|account)(\s|$)/i.test(q) && /^\s*select/i.test(q),
    )
    expect(accountReads, seen.join('\n')).not.toHaveLength(0)

    // The actual assertion. Checked across EVERY statement, not just the
    // account reads: a delete or a RETURNING clause naming the column would be
    // just as wrong. Post-0029 the column does not exist, so a statement
    // naming it would not merely be wrong - it would fail at D1.
    const naming = seen.filter((q) => /issuer/i.test(q))
    expect(naming, `statements naming issuer:\n${naming.join('\n')}`).toEqual([])

    // And the deletion was real, so the SQL above is the SQL of a working
    // delete rather than of a request that bailed out early.
    const after = await env.DB.prepare(
      'select count(*) as n from user where id = ?',
    )
      .bind(userId)
      .first<{ n: number }>()
    expect(after?.n).toBe(0)
    const sessions = await env.DB.prepare(
      'select count(*) as n from session where user_id = ?',
    )
      .bind(userId)
      .first<{ n: number }>()
    expect(sessions?.n).toBe(0)
  })
})
