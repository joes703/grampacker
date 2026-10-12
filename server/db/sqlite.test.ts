import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openSqlite, type Sqlite } from './index'
import { applyMigrations, MigrationStateError, pendingMigrationCount } from './migrate'
import { SQLITE_MAX_PARAMS } from '../repos/chunk-ids'

// The database foundation, against real files: the pragmas every connection
// gets, and the migration runner that builds a fresh database.

const scratch: string[] = []
const open: Sqlite[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'grampacker-db-'))
  scratch.push(dir)
  return dir
}

function openFile(path: string): Sqlite {
  const sqlite = openSqlite(path)
  open.push(sqlite)
  return sqlite
}

afterEach(() => {
  for (const sqlite of open.splice(0)) sqlite.close()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function count(sqlite: Sqlite, type: 'table' | 'trigger' | 'index'): number {
  const row = sqlite
    .prepare(
      `select count(*) as n from sqlite_schema where type = ? and name not like 'sqlite_%'`,
    )
    .get(type) as { n: number }
  return row.n
}

describe('openSqlite', () => {
  it('sets foreign keys, WAL, synchronous NORMAL and a 5 s busy timeout', () => {
    const sqlite = openFile(join(tempDir(), 'app.db'))
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    // 1 = NORMAL (0 OFF, 2 FULL, 3 EXTRA).
    expect(sqlite.pragma('synchronous', { simple: true })).toBe(1)
    expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000)
  })

  it('binds up to 32766 parameters in one statement', () => {
    // Repositories bind a request-bounded list in one statement where it is
    // far below this (server/repos/food.ts), and list duplication chunks to a
    // quarter of it (PARAM_BUDGET_PER_STATEMENT in server/repos/chunk-ids.ts). A
    // better-sqlite3 build with a lower limit must fail here first.
    const sqlite = openFile(join(tempDir(), 'params.db'))
    const select = (n: number) =>
      sqlite.prepare(`select 1 where 0 in (${Array(n).fill('?').join(',')})`)
    expect(select(SQLITE_MAX_PARAMS).get(...Array(SQLITE_MAX_PARAMS).fill(1))).toBeUndefined()
    expect(() => select(SQLITE_MAX_PARAMS + 1)).toThrow('too many SQL variables')
  })
})

describe('applyMigrations', () => {
  it('builds a fresh database from migrations/ and records it in the Drizzle ledger', () => {
    const sqlite = openFile(join(tempDir(), 'fresh.db'))
    expect(applyMigrations(sqlite)).toBe(1)

    // The baseline's 18 application tables, plus the ledger itself.
    expect(count(sqlite, 'table')).toBe(19)
    // The hand-written triggers (every row cap, the rank-range, rerank,
    // same-list, cycle and owner guards) arrive with the schema.
    expect(count(sqlite, 'trigger')).toBe(22)

    const journal = JSON.parse(
      readFileSync('migrations/meta/_journal.json', 'utf8'),
    ) as { entries: { tag: string; when: number }[] }
    const ledger = sqlite
      .prepare('select hash, created_at from __drizzle_migrations order by created_at')
      .all() as { hash: string; created_at: number }[]
    expect(ledger).toEqual(
      journal.entries.map((entry) => ({
        hash: createHash('sha256')
          .update(readFileSync(`migrations/${entry.tag}.sql`, 'utf8'))
          .digest('hex'),
        created_at: entry.when,
      })),
    )
    expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('is safe to rerun: applied migrations are skipped', () => {
    const path = join(tempDir(), 'rerun.db')
    expect(applyMigrations(openFile(path))).toBe(1)
    expect(applyMigrations(openFile(path))).toBe(0)
    const sqlite = openFile(path)
    expect(
      (sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n,
    ).toBe(1)
  })

  it('rolls back every pending migration when one fails', () => {
    // A copy of migrations/ plus a second migration whose last statement fails.
    // Nothing from either migration may remain: not the baseline's tables, not
    // the first statement of the broken one, and no ledger row.
    const folder = join(tempDir(), 'migrations')
    cpSync('migrations', folder, { recursive: true })
    const journalPath = join(folder, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[]
    }
    const last = journal.entries[journal.entries.length - 1]!
    journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1, tag: '9999_broken' })
    writeFileSync(journalPath, JSON.stringify(journal))
    writeFileSync(
      join(folder, '9999_broken.sql'),
      'CREATE TABLE half_done (id text);\n--> statement-breakpoint\nINSERT INTO no_such_table VALUES (1);\n',
    )

    const sqlite = openFile(join(tempDir(), 'broken.db'))
    expect(() => applyMigrations(sqlite, folder)).toThrow(/no such table/)
    expect(
      sqlite
        .prepare(`select name from sqlite_schema where name in ('lists', 'half_done')`)
        .all(),
    ).toEqual([])
    expect(
      (sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n,
    ).toBe(0)
  })

  // A copy of migrations/ that a test can edit, plus helpers for its journal.
  type Journal = {
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[]
  }
  function copyMigrations(): { folder: string; journal: Journal; save(): void } {
    const folder = join(tempDir(), 'migrations')
    cpSync('migrations', folder, { recursive: true })
    const journalPath = join(folder, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal
    return { folder, journal, save: () => writeFileSync(journalPath, JSON.stringify(journal)) }
  }
  function addMigration(
    copy: ReturnType<typeof copyMigrations>,
    tag: string,
    when: number,
    sql: string,
  ) {
    const last = copy.journal.entries[copy.journal.entries.length - 1]!
    copy.journal.entries.push({ ...last, idx: last.idx + 1, when, tag })
    copy.save()
    writeFileSync(join(copy.folder, `${tag}.sql`), sql)
  }

  it('refuses a database whose applied migration was edited afterwards', () => {
    const sqlite = openFile(join(tempDir(), 'edited.db'))
    applyMigrations(sqlite)
    const copy = copyMigrations()
    const baseline = copy.journal.entries[0]!.tag
    writeFileSync(
      join(copy.folder, `${baseline}.sql`),
      readFileSync(`migrations/${baseline}.sql`, 'utf8') + '\n-- edited after shipping\n',
    )
    expect(() => pendingMigrationCount(sqlite, copy.folder)).toThrow(MigrationStateError)
    expect(() => applyMigrations(sqlite, copy.folder)).toThrow(MigrationStateError)
  })

  it('refuses a journal entry dated before the one it follows', () => {
    // Without this check the runner, which compares timestamps, would treat
    // the late entry as already applied and never run it.
    const sqlite = openFile(join(tempDir(), 'order.db'))
    applyMigrations(sqlite)
    const copy = copyMigrations()
    const first = copy.journal.entries[0]!
    addMigration(copy, '0001_backdated', first.when - 1, 'CREATE TABLE backdated (id text);')
    expect(() => pendingMigrationCount(sqlite, copy.folder)).toThrow(MigrationStateError)
    expect(() => applyMigrations(sqlite, copy.folder)).toThrow(MigrationStateError)
    expect(sqlite.prepare(`select 1 from sqlite_schema where name = 'backdated'`).get()).toBeUndefined()
  })

  it('accepts a database AHEAD of this code, so the previous image can run after a deploy', () => {
    const copy = copyMigrations()
    const last = copy.journal.entries[copy.journal.entries.length - 1]!
    addMigration(copy, '0001_newer', last.when + 1, 'CREATE TABLE newer (id text);')
    const sqlite = openFile(join(tempDir(), 'ahead.db'))
    expect(applyMigrations(sqlite, copy.folder)).toBe(2)
    // The real migrations/ (the "previous image") lacks 0001_newer.
    expect(pendingMigrationCount(sqlite)).toBe(0)
    expect(applyMigrations(sqlite)).toBe(0)
  })
})

