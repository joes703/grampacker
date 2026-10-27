import { openSqlite, type Sqlite } from '../db'
import { applyMigrations } from '../db/migrate'
import type { AppEnv } from '../env'
import { createApp } from '../index'

// The API tests' environment: the real app against a real SQLite database
// built by the real migrations.
//
// One database per test FILE. Vitest runs every file in its own module
// graph, so this module - and the in-memory database it opens - is created
// fresh for each file and shared by the tests inside it
// (docs/testing-and-ci.md section 5). openSqlite sets the production pragmas,
// foreign keys included.
const sqlite = openSqlite(':memory:')
applyMigrations(sqlite)

export const env: AppEnv = {
  DB: sqlite,
  BETTER_AUTH_SECRET: 'test-only-secret-at-least-32-chars-long!',
  BETTER_AUTH_URL: 'http://localhost:5173',
  EMAIL_FROM: 'grampacker <no-reply@grampacker.app>',
  // The real build output only exists after `vite build`; tests get a small
  // fixture so static serving (and the security headers in front of it) is
  // exercisable.
  STATIC_DIR: 'server/test/fixtures/assets',
}

// The app every API test calls, built once per file from `env`. A test that
// needs another configuration or connection builds its own with createApp.
export const app = createApp(env)

// Raw SQL for test setup and assertions, in the call shape the tests were
// first written in (`prepare(sql).bind(...).first()/all()/run()`), which many
// of them still use. Not used by application code. New tests may call
// better-sqlite3 on `env.DB` directly instead; for several statements in one
// transaction they must (`env.DB.transaction(...)`).
type Param = string | number | bigint | boolean | null | Buffer

function toSqlite(params: Param[]): (string | number | bigint | null | Buffer)[] {
  // Tests pass booleans for 0/1 columns; better-sqlite3 refuses them.
  return params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p))
}

class TestStatement {
  constructor(
    private readonly sqlite: Sqlite,
    readonly sql: string,
    private readonly params: Param[] = [],
  ) {}

  bind(...params: Param[]): TestStatement {
    return new TestStatement(this.sqlite, this.sql, params)
  }

  // First row, or one column of it; null when there is no row.
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.exec('get') as Record<string, unknown> | undefined
    if (row === undefined) return null
    return (column === undefined ? row : row[column]) as T
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.exec('all') as T[] }
  }

  async run(): Promise<{ meta: { changes: number; last_row_id: number } }> {
    const stmt = this.sqlite.prepare(this.sql)
    if (stmt.reader) {
      stmt.all(...toSqlite(this.params))
      return { meta: { changes: 0, last_row_id: 0 } }
    }
    const info = stmt.run(...toSqlite(this.params))
    return { meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } }
  }

  private exec(mode: 'get' | 'all'): unknown {
    const stmt = this.sqlite.prepare(this.sql)
    const params = toSqlite(this.params)
    if (!stmt.reader) {
      stmt.run(...params)
      return mode === 'get' ? undefined : []
    }
    return mode === 'get' ? stmt.get(...params) : stmt.all(...params)
  }
}

export const testDb = {
  prepare(sql: string): TestStatement {
    return new TestStatement(sqlite, sql)
  },
}
