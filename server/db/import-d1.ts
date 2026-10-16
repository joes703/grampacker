import { createHash, randomBytes } from 'node:crypto'
import { closeSync, existsSync, linkSync, openSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import Database from 'better-sqlite3'
import { applyMigrations, DEFAULT_MIGRATIONS_FOLDER, pendingMigrationCount } from './migrate'

// The one-time move from D1 to SQLite (docs/vps-bootstrap-and-migration-runbook.md
// sections 10 and 11). The rehearsal and the cutover run exactly this, with
// the same checks:
//
//   node dist/server/node.js import-d1 --export <file> --d1-counts <file> --out <file>
//
// --export     the FULL `wrangler d1 export` (schema and data), as Wrangler
//              wrote it. A data-only export cannot be used: it still holds
//              D1's own ledger rows, which the app schema has no table for.
// --d1-counts  `wrangler d1 execute --json` output of deploy/d1-row-counts.sql,
//              taken right after the export.
// --out        the database to create. Never overwritten: an existing file,
//              or a -wal, -shm or -journal beside it, is refused. Moving an
//              old one aside is the runbook's job.
//
// The export is trusted input (the owner's own Wrangler output, checked
// against SHA256SUMS). It runs in an in-memory database that this process
// throws away; the container (no network, export mounted read-only) is what
// confines it, not this code.
//
// Output and errors name tables, columns, counts and SQLite error codes,
// never a value from the database or a piece of the export: the report is
// pasted into notes, and the data includes emails and passkey keys.

// Authentication state that must not survive the move: everyone signs in
// again on the new server (docs/vps-migration-plan.md "Authentication
// continuity"). Magic-link rows and rate-limit buckets are short-lived anyway.
const REMOVED = new Set(['session', 'verification', 'rate_limits'])

// Coordination tables that are correct only when EMPTY (server/db/app-schema.ts).
// A row in one means D1 was caught mid-statement; nothing is copied from them.
const MUST_BE_EMPTY = new Set([
  '_pack_reorder_guard',
  '_food_pack_reorder_guard',
  '_packing_location_delete_state',
  '_food_location_delete_state',
])

// Objects that belong to one side only: D1's ledger, Drizzle's ledger, and
// SQLite's and Cloudflare's internal tables.
const LEDGERS = new Set(['d1_migrations', '__drizzle_migrations'])
const isInternal = (name: string) =>
  LEDGERS.has(name) || name.startsWith('sqlite_') || name.startsWith('_cf_')

const SIDECARS = ['-wal', '-shm', '-journal']

const USAGE =
  'usage: import-d1 --export <d1-full.sql> --d1-counts <d1-counts.json> --out <new database file>'

// A failure with a message that is safe to print: names and counts only.
export class ImportError extends Error {}

// The one failure after publication: the output is complete and checked, but
// its temporary second name could not be removed.
export class LeftoverError extends ImportError {}

type Value = bigint | number | string | Buffer | null
type SchemaObject = { type: string; sql: string | null }

function schemaOf(db: Database.Database): Map<string, SchemaObject> {
  const rows = db
    .prepare(`SELECT type, name, sql FROM sqlite_schema ORDER BY name`)
    .all() as { type: string; name: string; sql: string | null }[]
  return new Map(rows.filter((r) => !isInternal(r.name)).map((r) => [r.name, { type: r.type, sql: r.sql }]))
}

// Exact comparison, no normalization: the baseline was generated from
// production's own sqlite_master, and a whitespace or quoting rule could hide
// a change inside a string literal (a CHECK or a trigger).
function compareSchema(actual: Map<string, SchemaObject>, expected: Map<string, SchemaObject>, what: string) {
  const problems: string[] = []
  for (const [name, object] of expected) {
    const other = actual.get(name)
    if (!other) problems.push(`${name} (missing)`)
    else if (other.type !== object.type || other.sql !== object.sql) problems.push(`${name} (different)`)
  }
  for (const name of actual.keys()) {
    if (!expected.has(name)) problems.push(`${name} (not in migrations/)`)
  }
  if (problems.length > 0) {
    throw new ImportError(`${what} differs from migrations/: ${problems.join(', ')}`)
  }
}

// The D1 ledger has the 30 files that the 2026-09-26 collapse replaced
// (docs/incidents.md), then 0000_baseline.sql, added by hand. From the
// baseline on it must list exactly the journal's files, in order: then D1's
// schema is the one migrations/ builds, and nothing applied to D1 is missing
// here.
function checkLedger(source: Database.Database, migrationsFolder: string): string {
  const hasLedger = source
    .prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'd1_migrations'`)
    .get()
  if (!hasLedger) throw new ImportError('the export has no d1_migrations ledger')
  const ledger = (source.prepare(`SELECT name FROM d1_migrations ORDER BY id`).all() as { name: string }[]).map(
    (r) => r.name,
  )
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string }[]
  }
  const files = journal.entries.map((e) => `${e.tag}.sql`)
  const start = ledger.indexOf(files[0] ?? '')
  const applied = start < 0 ? [] : ledger.slice(start)
  if (applied.length !== files.length || applied.some((name, i) => name !== files[i])) {
    throw new ImportError(
      `the D1 ledger does not match migrations/: from ${files[0] ?? '(none)'} on it lists ` +
        `${applied.length > 0 ? applied.join(', ') : 'nothing'}; migrations/ has ${files.join(', ')}`,
    )
  }
  return `${ledger.length} rows, newest ${ledger[ledger.length - 1] ?? '(none)'}`
}

// The `--json` output of `wrangler d1 execute` for deploy/d1-row-counts.sql:
// [{ "results": [{ "<table>": <count>, ... }], "success": true, ... }]
function readCounts(path: string): Map<string, number> {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    if (err instanceof SyntaxError) throw new ImportError(`${path} is not JSON`)
    throw err
  }
  const row = Array.isArray(parsed) ? (parsed[0] as { results?: unknown[] } | undefined)?.results?.[0] : undefined
  if (row === null || typeof row !== 'object') {
    throw new ImportError(`${path} is not wrangler d1 execute --json output with one result row`)
  }
  const counts = new Map<string, number>()
  for (const [table, value] of Object.entries(row)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new ImportError(`${path}: the count for ${table} is not a whole number`)
    }
    counts.set(table, value)
  }
  return counts
}

function rowCount(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n
}

function columns(db: Database.Database, table: string): { name: string; pk: number }[] {
  return db.pragma(`table_info("${table}")`) as { name: string; pk: number }[]
}

// Every value with its storage type: safeIntegers keeps integers above 2^53
// exact (as bigint), REALs stay numbers, text stays text, blobs stay Buffers.
// Bound back unchanged, so each value is stored with the type it had.
function selectAll(db: Database.Database, table: string): Value[][] {
  const cols = columns(db, table)
  const keys = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk)
  const order = keys.length > 0 ? keys.map((c) => `"${c.name}"`).join(', ') : 'rowid'
  return db
    .prepare(`SELECT ${cols.map((c) => `"${c.name}"`).join(', ')} FROM "${table}" ORDER BY ${order}`)
    .raw(true)
    .safeIntegers(true)
    .all() as Value[][]
}

function copyTable(source: Database.Database, target: Database.Database, table: string) {
  const names = columns(source, table).map((c) => `"${c.name}"`)
  const insert = target.prepare(
    `INSERT INTO "${table}" (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
  )
  for (const row of selectAll(source, table)) insert.run(...row)
}

function sameValue(a: Value | undefined, b: Value | undefined): boolean {
  if (Buffer.isBuffer(a) || Buffer.isBuffer(b)) {
    return Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.equals(b)
  }
  return Object.is(a, b)
}

function sameRows(source: Database.Database, target: Database.Database, table: string): boolean {
  const a = selectAll(source, table)
  const b = selectAll(target, table)
  return (
    a.length === b.length &&
    a.every((row, i) => {
      const other = b[i]
      return other !== undefined && row.length === other.length && row.every((v, j) => sameValue(v, other[j]))
    })
  )
}

function checkIntegrity(db: Database.Database, what: string) {
  const integrity = db.pragma('integrity_check', { simple: true })
  if (integrity !== 'ok') throw new ImportError(`${what}: integrity_check did not return ok`)
  const broken = db.pragma('foreign_key_check') as { table: string; parent: string }[]
  if (broken.length > 0) {
    const pairs = [...new Set(broken.map((r) => `${r.table} -> ${r.parent}`))]
    throw new ImportError(`${what}: foreign_key_check found ${broken.length} broken foreign key reference(s): ${pairs.join(', ')}`)
  }
}

export type ImportOptions = {
  exportPath: string
  countsPath: string
  outPath: string
  migrationsFolder?: string
}

// Throws ImportError (safe message), a better-sqlite3 SqliteError, or a file
// system error. Before the final link, any failure removes the partial file,
// so `outPath` exists only if every check passed.
export function importD1(opts: ImportOptions, log: (line: string) => void): void {
  const { exportPath, countsPath, outPath } = opts
  const migrationsFolder = opts.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER

  for (const path of [outPath, ...SIDECARS.map((s) => outPath + s)]) {
    if (existsSync(path)) {
      throw new ImportError(`${path} already exists. The import never overwrites: move it aside first.`)
    }
  }
  if (!existsSync(dirname(outPath))) throw new ImportError(`${dirname(outPath)} does not exist`)

  const exportBytes = readFileSync(exportPath)
  const d1Counts = readCounts(countsPath)
  log('import-d1: D1 export to a new SQLite database')
  log(`export: ${exportPath} (sha256 ${createHash('sha256').update(exportBytes).digest('hex')})`)

  // D1 as exported, in memory. Foreign keys are off: the export inserts
  // table by table (a child row can come before its parent) and creates the
  // triggers last. The new database's foreign_key_check proves the result.
  const source = new Database(':memory:')
  const reference = new Database(':memory:')
  try {
    source.pragma('foreign_keys = OFF')
    source.exec(exportBytes.toString('utf8'))
    log(`d1 ledger: ok (${checkLedger(source, migrationsFolder)})`)

    applyMigrations(reference, migrationsFolder)
    const expected = schemaOf(reference)
    compareSchema(schemaOf(source), expected, 'the export schema')
    const kinds = [...expected.values()]
    const tally = (type: string) => kinds.filter((o) => o.type === type).length
    log(
      `schema: identical to migrations/ (${tally('table')} tables, ${tally('index')} indexes, ${tally('trigger')} triggers)`,
    )

    const tables = [...expected].filter(([, o]) => o.type === 'table').map(([name]) => name)
    const nonEmpty = tables.filter((t) => MUST_BE_EMPTY.has(t) && rowCount(source, t) > 0)
    if (nonEmpty.length > 0) throw new ImportError(`must be empty but have rows: ${nonEmpty.join(', ')}`)

    const missing = tables.filter((t) => !d1Counts.has(t))
    const extra = [...d1Counts.keys()].filter((t) => !tables.includes(t))
    if (missing.length > 0) throw new ImportError(`the D1 counts are missing: ${missing.join(', ')}`)
    if (extra.length > 0) throw new ImportError(`the D1 counts name tables migrations/ does not create: ${extra.join(', ')}`)
    const exported = new Map(tables.map((t) => [t, rowCount(source, t)]))
    const differ = tables.filter((t) => exported.get(t) !== d1Counts.get(t))
    if (differ.length > 0) {
      throw new ImportError(
        `row counts differ from D1: ${differ.map((t) => `${t} (export ${exported.get(t)}, D1 ${d1Counts.get(t)})`).join(', ')}. ` +
          'Something wrote to D1 between the export and the counts: export again.',
      )
    }

    const kept = tables.filter((t) => !REMOVED.has(t) && !MUST_BE_EMPTY.has(t))
    const partial = `${outPath}.partial-${randomBytes(6).toString('hex')}`
    // Exclusive create: never reuses or replaces a file.
    closeSync(openSync(partial, 'wx', 0o600))
    let target: Database.Database | undefined
    try {
      target = new Database(partial)
      // A rollback journal, not WAL: the result is one self-contained file.
      // openSqlite would select WAL; the server does that when it opens it.
      target.pragma('journal_mode = DELETE')
      applyMigrations(target, migrationsFolder)
      // Off for the copy, then proved by foreign_key_check before COMMIT.
      // It cannot change inside a transaction, so it is set here.
      target.pragma('foreign_keys = OFF')
      const db = target
      db.transaction(() => {
        // The triggers check rows against other tables (a container item and
        // its packing location refer to each other), so no table order can
        // load valid data with them active. Dropped and recreated from their
        // own SQL inside this transaction; the schema check below proves
        // they are back unchanged.
        const triggers = db
          .prepare(`SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' ORDER BY name`)
          .all() as { name: string; sql: string }[]
        for (const t of triggers) db.exec(`DROP TRIGGER "${t.name}"`)
        for (const table of kept) copyTable(source, db, table)
        for (const t of triggers) db.exec(t.sql)

        checkIntegrity(db, 'the new database')
        compareSchema(schemaOf(db), expected, 'the new database schema')
        const short = kept.filter((t) => rowCount(db, t) !== exported.get(t))
        if (short.length > 0) throw new ImportError(`row counts differ after the copy: ${short.join(', ')}`)
        const changed = kept.filter((t) => !sameRows(source, db, t))
        if (changed.length > 0) throw new ImportError(`rows differ from the export: ${changed.join(', ')}`)
      }).immediate()
      target.close()
      target = undefined

      // The closed file, as it will be published.
      const left = SIDECARS.map((s) => partial + s).filter((p) => existsSync(p))
      if (left.length > 0) throw new ImportError(`files left beside the new database: ${left.map((p) => basename(p)).join(', ')}`)
      const check = new Database(partial, { readonly: true, fileMustExist: true })
      try {
        checkIntegrity(check, 'the closed database')
        if (check.pragma('journal_mode', { simple: true }) !== 'delete') {
          throw new ImportError('the closed database is not in rollback journal mode')
        }
        if (pendingMigrationCount(check, migrationsFolder) !== 0) {
          throw new ImportError('the closed database has pending migrations')
        }
      } finally {
        check.close()
      }

      log('')
      log(`${'table'.padEnd(32)}${'export'.padStart(8)}${'d1'.padStart(8)}${'imported'.padStart(10)}`)
      const result = new Database(partial, { readonly: true, fileMustExist: true })
      try {
        for (const t of tables) {
          const action = REMOVED.has(t) ? 'removed' : MUST_BE_EMPTY.has(t) ? 'empty' : 'kept'
          log(
            `${t.padEnd(32)}${String(exported.get(t)).padStart(8)}${String(d1Counts.get(t)).padStart(8)}` +
              `${String(rowCount(result, t)).padStart(10)}  ${action}`,
          )
        }
      } finally {
        result.close()
      }
      log('')
      log('foreign keys: ok (foreign_key_check returned no rows)')
      log('integrity: ok')
      log('content: every kept table equals the export, row by row and value by value')
      log(`removed: ${[...REMOVED].join(', ')} (everyone signs in again)`)

      // The publication boundary. link() fails if outPath exists, so this
      // never overwrites, even if a file appeared during the import.
      try {
        linkSync(partial, outPath)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new ImportError(`${outPath} appeared during the import; nothing was overwritten`)
        }
        throw err
      }
    } catch (err) {
      target?.close()
      for (const path of [partial, ...SIDECARS.map((s) => partial + s)]) rmSync(path, { force: true })
      throw err
    }
    try {
      unlinkSync(partial)
    } catch {
      throw new LeftoverError(
        `${outPath} is complete and passed every check, but ${partial} (a second name for the same file) ` +
          'could not be removed. Remove it by hand before starting the app.',
      )
    }
    log(`output: ${outPath} (one file, rollback journal mode, no -wal or -shm)`)
    log('result: OK')
  } finally {
    source.close()
    reference.close()
  }
}

// The command: parses its options, runs the import, and turns any failure into
// a printable line. Exit status: 0 imported, 1 failed (nothing written, unless
// it is a LeftoverError, which says so), 2 usage.
export function importD1Command(
  argv: string[],
  log: (line: string) => void,
  error: (line: string) => void,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): number {
  let values
  try {
    values = parseArgs({
      args: argv,
      options: {
        export: { type: 'string' },
        'd1-counts': { type: 'string' },
        out: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }).values
  } catch {
    error(USAGE)
    return 2
  }
  const exportPath = values.export
  const countsPath = values['d1-counts']
  const outPath = values.out
  if (!exportPath || !countsPath || !outPath) {
    error(USAGE)
    return 2
  }
  try {
    importD1({ exportPath, countsPath, outPath, migrationsFolder }, log)
    return 0
  } catch (err) {
    if (err instanceof LeftoverError) {
      error(`import-d1: ${err.message}`)
      return 1
    }
    if (err instanceof ImportError) {
      error(`import-d1 failed: ${err.message}`)
    } else if (err instanceof Database.SqliteError) {
      // SQLite's message can quote the statement or a value; only the code
      // is printed.
      error(`import-d1 failed: SQLite error ${err.code}`)
    } else {
      const code = (err as NodeJS.ErrnoException).code
      const path = (err as NodeJS.ErrnoException).path
      error(`import-d1 failed: ${code ?? 'unexpected error'}${path ? ` (${path})` : ''}`)
    }
    error('Nothing was written to the output path.')
    return 1
  }
}
