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
export const DEFAULT_MIGRATIONS_FOLDER = 'migrations'

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )
`

// The database and migrations/ disagree in a way no migration run can fix.
// The server refuses to start, and migrate refuses to run, until a person
// has looked.
export class MigrationStateError extends Error {}

// The migrations not yet applied, after checking that the ledger is an exact
// prefix of the journal:
//
// - journal timestamps must strictly increase. The runner orders by them,
//   and an entry dated before the newest applied one would otherwise be
//   skipped forever without a word;
// - each ledger row must match the journal entry in the same position, by
//   timestamp AND hash. A different hash means a shipped migration file was
//   edited (AGENTS.md forbids it) and the database was built from other SQL.
//
// A ledger LONGER than the journal is accepted when its overlap matches: that
// is the previous image running against a database the newer image already
// migrated, which is exactly the rollback the deploy relies on
// (docs/vps-migration-plan.md, "Rollback").
function pending(sqlite: Sqlite, migrationsFolder: string) {
  const migrations = readMigrationFiles({ migrationsFolder })
  migrations.forEach((m, i) => {
    const previous = migrations[i - 1]
    if (previous && m.folderMillis <= previous.folderMillis) {
      throw new MigrationStateError(
        `migrations/ journal entry ${i} (when ${m.folderMillis}) is not newer than entry ${i - 1}`,
      )
    }
  })
  const hasLedger = sqlite
    .prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '__drizzle_migrations'`)
    .get()
  if (!hasLedger) return migrations
  const ledger = sqlite
    .prepare('SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at, rowid')
    .all() as { hash: string; created_at: number | string }[]
  ledger.forEach((row, i) => {
    const expected = migrations[i]
    if (!expected) return // the database is ahead of this code; see above
    if (Number(row.created_at) !== expected.folderMillis || row.hash !== expected.hash) {
      throw new MigrationStateError(
        `applied migration ${i} does not match migrations/ entry ${i} (changed, removed or reordered)`,
      )
    }
  })
  return migrations.slice(ledger.length)
}

// How many migrations have not been applied. Read-only: it never creates the
// ledger. The server refuses to start unless this is 0, so it never serves a
// schema older than its code. Throws MigrationStateError on a mismatch.
export function pendingMigrationCount(
  sqlite: Sqlite,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): number {
  return pending(sqlite, migrationsFolder).length
}

// Applies every pending migration in one transaction and returns how many
// it applied, for logging.
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
