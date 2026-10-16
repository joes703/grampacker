import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../node'
import { importD1Command } from './import-d1'

// The one-time D1-to-SQLite import (runbook sections 10 and 11), against real
// files.
//
// Fixtures, both genuine Wrangler 4.149.0 output, never hand-edited:
// - fixtures/fixture-d1-export.sql: `wrangler d1 export --local` of a database built
//   from migrations/ by `wrangler d1 migrations apply --local`, holding
//   invented data: three users, passkeys, sessions, a verification row, a
//   rate-limit row, categories, gear, lists (one shared), a container item
//   whose packing location holds other items, and food. To regenerate it,
//   do the same in a scratch directory; never export production for a test.
// - fixtures/fixture-d1-counts.json: `wrangler d1 execute --local --json --command
//   "$(cat deploy/d1-row-counts.sql)"` on the same database.
// Variants below append statements to a copy of the export, the way a real
// export differs from the fixture, and adjust a copy of the counts.

const FIXTURES = join(__dirname, '../test/fixtures')
const EXPORT = readFileSync(join(FIXTURES, 'fixture-d1-export.sql'), 'utf8')
const COUNTS = JSON.parse(readFileSync(join(FIXTURES, 'fixture-d1-counts.json'), 'utf8')) as [
  { results: [Record<string, number>] },
]

const scratch: string[] = []
const open: Database.Database[] = []

afterEach(() => {
  for (const db of open.splice(0)) db.close()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'grampacker-import-'))
  scratch.push(dir)
  return dir
}

function readOnly(path: string): Database.Database {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  open.push(db)
  return db
}

// The fixture loaded as D1 had it, to compare the import against.
function exportedDb(sql = EXPORT): Database.Database {
  const db = new Database(':memory:')
  open.push(db)
  db.pragma('foreign_keys = OFF')
  db.exec(sql)
  return db
}

function counts(change: Record<string, number> = {}) {
  const copy = structuredClone(COUNTS)
  Object.assign(copy[0].results[0], change)
  return copy
}

type Run = { code: number; out: string; dir: string; stdout: string; stderr: string }

function run(opts: { sql?: string; counts?: unknown; prepare?: (dir: string) => void } = {}): Run {
  const dir = tempDir()
  const exportPath = join(dir, 'd1-full.sql')
  const countsPath = join(dir, 'd1-counts.json')
  writeFileSync(exportPath, opts.sql ?? EXPORT)
  writeFileSync(countsPath, JSON.stringify(opts.counts ?? COUNTS))
  // Its own directory, as /data is in the container, so a test can see
  // every file the import leaves there.
  const outDir = join(dir, 'data')
  mkdirSync(outDir)
  const out = join(outDir, 'grampacker.db')
  opts.prepare?.(outDir)
  const stdout: string[] = []
  const stderr: string[] = []
  const code = importD1Command(
    ['--export', exportPath, '--d1-counts', countsPath, '--out', out],
    (line) => stdout.push(line),
    (line) => stderr.push(line),
  )
  return { code, out, dir: outDir, stdout: stdout.join('\n'), stderr: stderr.join('\n') }
}

function rowCount(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n
}

const KEPT = [
  'user',
  'account',
  'passkey',
  'categories',
  'gear_items',
  'lists',
  'list_items',
  'packing_locations',
  'list_food_slots',
  'list_food_items',
  'list_food_item_slots',
]

describe('import-d1', () => {
  it('imports a Wrangler export into one new database and reports OK', () => {
    const r = run()
    expect(r.stderr).toBe('')
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('result: OK')
    const db = readOnly(r.out)
    const source = exportedDb()
    for (const table of KEPT) {
      expect(rowCount(db, table), table).toBe(rowCount(source, table))
      expect(rowCount(db, table), table).toBeGreaterThan(0)
    }
    // The container item, its packing location and the items inside it.
    expect(
      db
        .prepare(
          `SELECT li.id FROM list_items li JOIN packing_locations pl ON pl.id = li.packing_location_id
           WHERE pl.container_list_item_id = 'li-ann-pack' ORDER BY li.id`,
        )
        .all(),
    ).toEqual([{ id: 'li-ann-stove' }, { id: 'li-ann-tent' }])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('removes sessions, verification rows and rate-limit buckets', () => {
    const source = exportedDb()
    expect(rowCount(source, 'session')).toBeGreaterThan(0)
    expect(rowCount(source, 'verification')).toBeGreaterThan(0)
    expect(rowCount(source, 'rate_limits')).toBeGreaterThan(0)
    const r = run()
    expect(r.code).toBe(0)
    const db = readOnly(r.out)
    expect(rowCount(db, 'session')).toBe(0)
    expect(rowCount(db, 'verification')).toBe(0)
    expect(rowCount(db, 'rate_limits')).toBe(0)
  })

  it('keeps passkeys, users and accounts exactly as exported', () => {
    const r = run()
    expect(r.code).toBe(0)
    const db = readOnly(r.out)
    const source = exportedDb()
    for (const table of ['passkey', 'user', 'account']) {
      const all = `SELECT * FROM "${table}" ORDER BY id`
      expect(db.prepare(all).all(), table).toEqual(source.prepare(all).all())
    }
    expect(db.prepare(`SELECT credential_id, public_key, counter, user_id FROM passkey ORDER BY id`).all()).toEqual([
      {
        credential_id: 'cred-ann-1_-AZaz09',
        public_key: 'pQECAyYgASFYIFixture+publicKey/AAA=',
        counter: 7,
        user_id: 'u-ann',
      },
      {
        credential_id: 'cred-bob-1',
        public_key: 'pQECAyYgASFYIFixture+publicKey/BBB=',
        counter: 0,
        user_id: 'u-bob',
      },
    ])
  })

  it('copies values exactly: large integers, fractions, unicode and newlines', () => {
    const sql = `${EXPORT}\nUPDATE "passkey" SET "counter" = 9007199254740993 WHERE "id" = 'pk-bob-1';\n`
    const r = run({ sql })
    expect(r.stderr).toBe('')
    expect(r.code).toBe(0)
    const db = readOnly(r.out)
    const counter = db.prepare(`SELECT counter FROM passkey WHERE id = 'pk-bob-1'`).safeIntegers(true).get() as {
      counter: bigint
    }
    expect(counter.counter).toBe(9007199254740993n)
    expect(db.prepare(`SELECT weight_grams AS w FROM gear_items WHERE id = 'g-ann-tent'`).get()).toEqual({ w: 1130.5 })
    expect(db.prepare(`SELECT name FROM "user" WHERE id = 'u-cyd'`).get()).toEqual({ name: 'Cyd ✓' })
    expect(db.prepare(`SELECT description FROM gear_items WHERE id = 'g-ann-stove'`).get()).toEqual({
      description: 'line one\nline two',
    })
  })

  it('leaves one self-contained file in rollback journal mode', () => {
    const r = run()
    expect(r.code).toBe(0)
    expect(readdirSync(r.dir)).toEqual(['grampacker.db'])
    // Only the main file, copied alone, holds everything.
    const elsewhere = join(tempDir(), 'copy.db')
    copyFileSync(r.out, elsewhere)
    const db = readOnly(elsewhere)
    expect(db.pragma('journal_mode', { simple: true })).toBe('delete')
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(rowCount(db, 'user')).toBe(3)
  })

  it('refuses a row count that differs from D1, and writes nothing', () => {
    const r = run({ counts: counts({ user: 4 }) })
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/user.*export 3.*D1 4/)
    expect(readdirSync(r.dir)).toEqual([])
  })

  it('refuses counts that do not name every table', () => {
    const c = counts()
    delete c[0].results[0].passkey
    const r = run({ counts: c })
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('passkey')
    expect(readdirSync(r.dir)).toEqual([])
  })

  it('rolls back on a broken relationship and leaves no partial file', () => {
    const sql =
      `${EXPORT}\nINSERT INTO "list_items" ("id","user_id","list_id","gear_item_id","quantity","is_worn",` +
      `"is_consumable","is_packed","is_ready","sort_order","created_at","updated_at","packing_location_id",` +
      `"pack_sort_order") VALUES('li-orphan','u-bob','l-bob-day','g-missing-secret-value',1,0,0,0,0,1,1,1,NULL,1);\n`
    const r = run({ sql, counts: counts({ list_items: 6 }) })
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/foreign key/i)
    expect(r.stderr).toContain('list_items')
    // Never a value from the database.
    expect(r.stderr + r.stdout).not.toContain('g-missing-secret-value')
    expect(readdirSync(r.dir)).toEqual([])
  })

  it('refuses an export whose schema differs from migrations/', () => {
    const sql = EXPORT.replace(
      "WHEN (SELECT count(*) FROM `categories` WHERE `user_id` = NEW.`user_id`) >= 500",
      "WHEN (SELECT count(*) FROM `categories` WHERE `user_id` = NEW.`user_id`) >= 501",
    )
    expect(sql).not.toBe(EXPORT)
    const r = run({ sql })
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('categories_user_cap')
    expect(readdirSync(r.dir)).toEqual([])
  })

  it('refuses an export whose D1 ledger does not match migrations/', () => {
    const sql = `${EXPORT}\nINSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(2,'0001_unknown.sql','2026-10-16 07:00:00');\n`
    const r = run({ sql })
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/ledger/i)
    expect(readdirSync(r.dir)).toEqual([])
  })

  it('reports a broken export by its SQLite error code, never its text', () => {
    const sql = `${EXPORT}\nINSERT INTO "user" VALUES('secret-looking-value' oops);\n`
    const r = run({ sql })
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('SQLITE_ERROR')
    expect(r.stderr + r.stdout).not.toContain('secret-looking-value')
    expect(r.stderr + r.stdout).not.toContain('oops')
    expect(readdirSync(r.dir)).toEqual([])
  })

  it('refuses to overwrite an existing database, and leaves it unchanged', () => {
    const r = run({ prepare: (dir) => writeFileSync(join(dir, 'grampacker.db'), 'existing') })
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('already exists')
    expect(readFileSync(r.out, 'utf8')).toBe('existing')
    expect(readdirSync(r.dir)).toEqual(['grampacker.db'])
  })

  it('refuses when a WAL file of the output exists without its database', () => {
    const r = run({ prepare: (dir) => writeFileSync(join(dir, 'grampacker.db-wal'), 'wal') })
    expect(r.code).toBe(1)
    expect(readdirSync(r.dir)).toEqual(['grampacker.db-wal'])
    expect(existsSync(r.out)).toBe(false)
  })

  it('prints usage and exits 2 without the three options', () => {
    const stderr: string[] = []
    expect(importD1Command(['--export', 'x.sql'], () => {}, (l) => stderr.push(l))).toBe(2)
    expect(stderr.join('\n')).toContain('--d1-counts')
  })

  it('runs as a server command with no application configuration', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'd1-full.sql'), EXPORT)
    writeFileSync(join(dir, 'd1-counts.json'), JSON.stringify(COUNTS))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const code = await main(
      [
        'import-d1',
        '--export',
        join(dir, 'd1-full.sql'),
        '--d1-counts',
        join(dir, 'd1-counts.json'),
        '--out',
        join(dir, 'out.db'),
      ],
      {},
    )
    expect(code).toBe(0)
    expect(existsSync(join(dir, 'out.db'))).toBe(true)
  })
})
