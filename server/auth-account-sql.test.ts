import { env, testDb } from './test/node-env'
import { describe, expect, it } from 'vitest'
import app from './index'
import { signUpVerifiedUser } from './test/auth-helpers'
import { CSRF_HEADER } from './middleware/csrf'
import { DELETE_ACCOUNT_USER_HEADER } from '../shared/auth'
import type { Sqlite } from './db'

// The account model better-auth queries must match the physical table,
// asserted ON THE WIRE.
//
// The schema files and the migrations are written separately, and only the
// SQL that reaches SQLite shows whether they agree. `db.select()` with no
// projection expands EVERY column of whatever model the adapter resolved. A
// regenerated schema or a hand-edit naming a column the table lacks fails
// with `no such column` in this better-sqlite3 build (it does not read an
// unknown double-quoted name as a string), so any test reaching the query
// would fail too. This one names the expected columns, so its failure says
// which column disagrees.

const ORIGIN = 'http://localhost:5173'

// The real SQLite connection with `prepare` instrumented: every statement's
// SQL is appended to `seen` and the REAL prepared statement is returned, so
// the request runs normally and the assertions happen afterwards. Same shape
// as the sabotage proxy in auth-error-logging.test.ts, minus the sabotage.
function recordingConnection(seen: string[]): Sqlite {
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
  // What this proves: every name the account statements of this deletion
  // path use is a real column of the table. It does NOT prove that of every
  // account query, or of the relational (`db.query`) path.
  it('names only real account columns in the SQL a user deletion emits', async () => {
    const email = `acct-sql-${crypto.randomUUID()}@example.com`
    const { cookie } = await signUpVerifiedUser(email, '')

    const before = await testDb.prepare('select id from user where email = ?')
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
          'x-forwarded-for': '10.55.0.1',
        },
        body: JSON.stringify({}),
      },
      { ...env, DB: recordingConnection(seen) },
    )
    expect(res.status, await res.text()).toBe(200)

    // The recorder saw the request at all. Without this a proxy that silently
    // stopped intercepting would make the column assertion below vacuous.
    expect(seen.length).toBeGreaterThan(0)

    // The account read really happened - otherwise "every name is a column"
    // would be true for the boring reason that nothing queried `account`.
    const accountReads = seen.filter(
      (q) => /\bfrom\s+("account"|account)(\s|$)/i.test(q) && /^\s*select/i.test(q),
    )
    expect(accountReads, seen.join('\n')).not.toHaveLength(0)

    // The actual assertion, over every statement on `account`, reads and
    // deletes alike: a WHERE on a wrong name matches no row, as quietly as a
    // wrong name in a select list. Drizzle double-quotes every identifier, so
    // each quoted name must be the table or one of its physical columns.
    const columns = new Set(
      (
        await testDb.prepare("select name from pragma_table_info('account')").all<{
          name: string
        }>()
      ).results.map((column) => column.name),
    )
    // The column list was really read, so an empty set cannot pass everything.
    expect(columns.has('user_id')).toBe(true)
    const accountStatements = seen.filter((q) =>
      /\b(from|into|update)\s+"account"(\s|$)/i.test(q),
    )
    const unknown = accountStatements.flatMap((q) =>
      [...q.matchAll(/"([^"]+)"/g)]
        .map((match) => match[1] ?? '')
        .filter((name) => name !== 'account' && !columns.has(name))
        .map((name) => `${name} in: ${q}`),
    )
    expect(unknown, 'names that are not account columns').toEqual([])

    // And the deletion was real, so the SQL above is the SQL of a working
    // delete rather than of a request that bailed out early.
    const after = await testDb.prepare(
      'select count(*) as n from user where id = ?',
    )
      .bind(userId)
      .first<{ n: number }>()
    expect(after?.n).toBe(0)
    const sessions = await testDb.prepare(
      'select count(*) as n from session where user_id = ?',
    )
      .bind(userId)
      .first<{ n: number }>()
    expect(sessions?.n).toBe(0)
  })
})
