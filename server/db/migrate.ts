import { readMigrationFiles } from 'drizzle-orm/migrator'
import type { Sqlite } from './index'

// Applies the Drizzle migrations in `migrations/` to a SQLite database.
//
// Why not Drizzle's own migrate(): it runs each `--> statement-breakpoint`
// chunk as one prepared statement, and the shipped baseline ends with a
// breakpoint, so its last chunk is empty. better-sqlite3 refuses an empty
// statement ("contains no statements"), and a shipped migration must never be
// edited (AGENTS.md "Migrations"). This runner reads the files with Drizzle's
// own reader and skips blank chunks; everything else matches Drizzle's
// SQLite migrator:
//
// - the ledger is Drizzle's `__drizzle_migrations` table, same columns, same
//   hash (sha256 of the file) and created_at (the journal's `when`), so
//   Drizzle's migrate() could take over later without re-running anything;
// - a migration runs only when its `when` is newer than the newest ledger row;
// - all pending migrations run in ONE transaction, so a failure leaves the
//   database exactly as it was.
//
// `exec` (not `prepare`) runs each chunk because a trigger body or a chunk
// without breakpoints may hold several statements.
//
// Returns how many migrations it applied, for logging.
export const DEFAULT_MIGRATIONS_FOLDER = 'migrations'

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )
`

function pending(sqlite: Sqlite, migrationsFolder: string) {
  const migrations = readMigrationFiles({ migrationsFolder })
  const hasLedger = sqlite
    .prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '__drizzle_migrations'`)
    .get()
  if (!hasLedger) return migrations
  const last = sqlite
    .prepare(
      'SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1',
    )
    .get() as { created_at: number | string } | undefined
  const lastApplied = last === undefined ? null : Number(last.created_at)
  return migrations.filter(
    (m) => lastApplied === null || lastApplied < m.folderMillis,
  )
}

// How many migrations have not been applied. Read-only: it never creates the
// ledger. The server refuses to start unless this is 0, so it never serves a
// schema older than its code.
export function pendingMigrationCount(
  sqlite: Sqlite,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): number {
  return pending(sqlite, migrationsFolder).length
}

export function applyMigrations(
  sqlite: Sqlite,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): number {
  sqlite.exec(LEDGER_DDL)
  const todo = pending(sqlite, migrationsFolder)
  const record = sqlite.prepare(
    'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
  )
  sqlite.transaction(() => {
    for (const migration of todo) {
      for (const chunk of migration.sql) {
        if (chunk.trim() !== '') sqlite.exec(chunk)
      }
      record.run(migration.hash, migration.folderMillis)
    }
  }).immediate()
  return todo.length
}
