import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { BatchItem, BatchResponse } from 'drizzle-orm/batch'
import * as schema from './schema'

// All DB access goes through this module. The app opens ONE better-sqlite3
// connection per process and every request shares it (docs/vps-migration-plan.md).
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

// One Drizzle instance per connection. createDb is called per request (and
// per better-auth instance); this keeps that cheap and keeps the connection
// count at one.
const instances = new WeakMap<Sqlite, Db>()

export function createDb(sqlite: Sqlite): Db {
  let db = instances.get(sqlite)
  if (!db) {
    db = drizzle(sqlite, { schema })
    instances.set(sqlite, db)
  }
  return db
}

// TEMPORARY compatibility for repositories not yet converted to transactions.
// It runs a D1-style statement list in one SQLite transaction and returns one
// result per statement, the way D1's db.batch() did, so those repositories keep
// their exact behavior until each is converted (docs/vps-migration-plan.md,
// "Implementation sequence" step 3). Delete it when no caller remains.
//
// Selects and statements with .returning() give their rows; other writes give
// better-sqlite3's run result. Drizzle's prepared query knows which one each
// statement is; `_prepare()` is Drizzle's own internal entry point for that
// (its D1 batch uses the same call), hence the cast.
//
// Async only so callers keep `await db.batch(...)`'s shape. The transaction
// itself runs synchronously, so nothing else can run in the middle of it.
export async function runBatch<
  U extends BatchItem<'sqlite'>,
  T extends Readonly<[U, ...U[]]>,
>(db: Db, statements: T): Promise<BatchResponse<T>> {
  type Prepared = { execute(): { sync(): unknown } }
  return db.transaction(() =>
    statements.map((statement) =>
      (statement as unknown as { _prepare(): Prepared })._prepare().execute().sync(),
    ),
  ) as BatchResponse<T>
}
