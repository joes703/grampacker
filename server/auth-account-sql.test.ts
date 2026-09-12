import { env } from 'cloudflare:test'
import { getTableColumns, getTableName } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import app from './index'
import { signUpVerifiedUser } from './test/auth-helpers'
import { CSRF_HEADER } from './middleware/csrf'
import { account as generatedAccount } from './db/auth-schema'
import { account as runtimeAccount } from './db/auth-runtime-schema'

// better-auth must not read `account.issuer`, asserted ON THE WIRE.
//
// Migration 0028 added that column NOT NULL with a unique index for
// better-auth 1.7.0-1.7.2. 1.7.3 reverted the column and turned schema
// validation on by default, so 1.7.4 rejects it before every /api/auth/*
// dispatch. Release A answers that by handing the adapter an issuer-free
// model (server/db/auth-runtime-schema.ts) rather than dropping the column,
// which has to wait one release (AGENTS.md, deploy ordering).
//
// A config option is a weak guarantee on its own: `db.select()` with no
// projection expands EVERY column in whatever model the adapter resolved, so
// a wiring mistake shows up only as different SQL. Hence the recorder.

const ORIGIN = 'http://localhost:5173'

type ColumnShape = {
  name: string
  dataType: string
  notNull: boolean
  primary: boolean
  hasDefault: boolean
}

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
  // Drift guard. auth-schema.ts is CLI-GENERATED and auth-runtime-schema.ts is
  // hand-written, so a regeneration that changes `account` would silently leave
  // the runtime model behind - and the runtime model is the one every auth
  // request uses. Pin the relationship instead of trusting the two files to be
  // edited together: identical but for `issuer`.
  it('differs from the generated model in exactly one column', () => {
    // Compared as plain records: same columns is not enough, since a differing
    // type or nullability would make the runtime model write rows the physical
    // table rejects.
    const shapeOf = (table: SQLiteTable): Record<string, ColumnShape> =>
      Object.fromEntries(
        Object.entries(getTableColumns(table)).map(([key, column]) => [
          key,
          {
            name: column.name,
            dataType: column.dataType,
            notNull: column.notNull,
            primary: column.primary,
            hasDefault: column.hasDefault,
          },
        ]),
      )

    const generated = shapeOf(generatedAccount)
    const runtime = shapeOf(runtimeAccount)

    expect(getTableName(runtimeAccount)).toBe(getTableName(generatedAccount))
    expect(Object.keys(generated)).toContain('issuer')

    const generatedWithoutIssuer = Object.fromEntries(
      Object.entries(generated).filter(([key]) => key !== 'issuer'),
    )
    expect(runtime).toEqual(generatedWithoutIssuer)
  })

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
      (q) => /\bfrom\s+"?account"?/i.test(q) && /^\s*select/i.test(q),
    )
    expect(accountReads, seen.join('\n')).not.toHaveLength(0)

    // The actual assertion. Checked across EVERY statement, not just the
    // account reads: a delete or a RETURNING clause naming the column would be
    // just as wrong.
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
