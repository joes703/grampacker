import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

// All DB access goes through this module. The app opens ONE better-sqlite3
// connection per process and every request shares it.
//
// Drizzle is pinned to the 0.45.x stable line because better-auth's adapter
// peers on drizzle-orm ^0.45.2 (see STACK.md). Upgrade to 1.x when
// better-auth's peer range admits it.
//
// Handlers must not call this directly - they receive user-scoped
// repositories instead, and an ESLint import boundary enforces that.

export type Sqlite = Database.Database
export type Db = BetterSQLite3Database<typeof schema>
// The handle a db.transaction() callback receives. Repos that run inside a
// transaction take `Db | Tx` so the same query code works in both places.
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

// Opens the database file and sets the connection pragmas. They are
// per-connection settings, so they must run on every open, not once in a
// migration.
//
// - foreign_keys: SQLite leaves FK enforcement OFF unless asked. Every
//   composite ownership FK in the schema depends on it.
// - journal_mode WAL: readers do not block the writer. Persistent in the file.
//   An in-memory database reports 'memory' instead, which is expected.
// - synchronous NORMAL: safe with WAL (a crash can lose the last commits, never
//   corrupt the file) and much faster than FULL.
// - busy_timeout: wait up to 5 s for a lock held by another connection (a
//   migration or a snapshot run) instead of failing at once.
export function openSqlite(path: string): Sqlite {
  const sqlite = new Database(path)
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('busy_timeout = 5000')
  return sqlite
}

// Called once per app (server/index.ts createApp), and by scripts and tests.
export function createDb(sqlite: Sqlite): Db {
  return drizzle(sqlite, { schema })
}
