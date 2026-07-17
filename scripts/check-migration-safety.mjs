#!/usr/bin/env node
// Proves that this branch's new D1 migrations preserve existing data.
//
// WHY THIS EXISTS
// ---------------
// The API suite migrates an EMPTY database, so it structurally cannot see a
// migration that destroys rows. Migration 0009 (food-plan link) shipped past a
// full green suite while silently cascade-deleting every list_items row:
// drizzle-kit generates the standard SQLite 12-step table rebuild and wraps the
// DROP in `PRAGMA foreign_keys=OFF`, which is correct for drizzle's own Node
// migrator (migrations run OUTSIDE a transaction) but inert on D1, which wraps
// every migration file INSIDE an implicit transaction - and SQLite silently
// ignores that pragma while a transaction is open. Enforcement stays ON, and
// `DROP TABLE lists` fires list_items' ON DELETE CASCADE. Neither tool is wrong
// on its own; the bug lives in the seam, which is exactly the kind of thing no
// single-tool doc warns you about. See AGENTS.md.
//
// A human reviewer caught 0009. This script is that reviewer, made mandatory.
//
// WHAT IT DOES
// ------------
//   1. Applies only the migrations that already exist on the base ref (what
//      production is running) to a throwaway local D1.
//   2. Seeds one row into every table, so the database looks like production
//      rather than like a fresh install.
//   3. Applies this branch's new migrations - the same `wrangler d1 migrations
//      apply` code path deploy.yml runs against production.
//   4. Asserts every seeded row still exists AND still holds the same values
//      in every column that existed beforehand.
//
// Step 4 catches both failure modes a rebuild has: rows cascading away, and an
// INSERT...SELECT that copies columns into the wrong slots. It also fails if a
// trigger or index that existed beforehand is gone afterwards.
//
// WHAT IT DOES NOT DO
// -------------------
// It proves nothing that EXISTED was lost or altered. It cannot tell you a
// migration did the right thing:
//   - A backfill into a NEW column is unchecked - the guard has no idea what the
//     value should have been. Test that in the migration's own PR.
//   - Fixtures cover every table, but not every state. Two users and a shared
//     list are here to catch the obvious ownership/filter mistakes; a migration
//     that only corrupts some third combination can still pass.
//   - It compares the base ref's schema as it exists IN YOUR CHECKOUT. On a
//     branch behind main it is really testing the merge base. CI runs on the PR
//     merge commit, which does include main.
//
// MAINTENANCE
// -----------
// Adding a table? Add a fixture row below - the script fails on any table it
// finds without one, so coverage cannot silently rot. A table may have several
// fixture rows, and all of them must set the same keys. Fixture columns that do
// not exist yet on the base ref are dropped automatically, so a fixture may be
// written against the schema as it looks AFTER your migration.
//
// Writing a migration that DELIBERATELY rewrites data? Declare each rewrite in
// EXPECTED_CHANGES (and, if it also needs a constraint proven, a POST_CHECKS
// probe) - the row-changed failure flips into an assertion that the rewrite
// happened exactly as declared.
//
// Usage: node scripts/check-migration-safety.mjs [--base=<git-ref>]

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const DB = 'grampacker'
const MIGRATIONS_DIR = 'migrations'

// Restricts a sqlite_master scan to tables we own. D1's authorizer rejects
// pragma_table_info() on its own internal tables with SQLITE_AUTH, so they have
// to be excluded in SQL, before the join - filtering in JS afterwards is too
// late. GLOB rather than LIKE: in a LIKE pattern '_' is a single-character
// wildcard, so 'sqlite_%' would also match a table named 'sqlited_thing'.
const appTablesFilter = (alias) =>
  `${alias}.type='table' and ${alias}.name not glob 'sqlite_*' ` +
  `and ${alias}.name not glob '_cf_*' and ${alias}.name <> 'd1_migrations'`

// A table rebuild copies rows through a scratch table. If one survives the
// migration, the recipe was left half-finished and production keeps a stale
// duplicate forever.
const isScratchTable = (name) => name.startsWith('__')

// Fixture rows, in foreign-key-safe insertion order. Values satisfy every CHECK
// constraint in server/db/*-schema.ts - the point is to look like real data, so
// a cascade has something to destroy.
//
// A table may appear more than once, and every row for it must set the SAME keys
// (use an explicit null). One row per table proves a table is covered; it does
// not prove every STATE is, so a second user and a second list exist to catch a
// migration that mangles cross-user ownership or drops non-default rows.
const FIXED_TS = 1_700_000_000_000

const FIXTURES = [
  ['user', {
    id: 'u-seed',
    name: 'Seed User',
    email: 'seed@example.test',
    email_verified: 1,
    image: null,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  // A second owner: a migration that reassigns or merges ownership looks
  // perfectly correct against a single-user database.
  ['user', {
    id: 'u-seed-2',
    name: 'Second Seed User',
    email: 'seed-2@example.test',
    email_verified: 1,
    image: null,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['session', {
    id: 'sess-seed',
    expires_at: FIXED_TS + 86_400_000,
    token: 'seed-session-token',
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
    ip_address: null,
    user_agent: null,
    user_id: 'u-seed',
  }],
  ['account', {
    id: 'acct-seed',
    account_id: 'acct-seed-provider-id',
    provider_id: 'credential',
    user_id: 'u-seed',
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['verification', {
    id: 'ver-seed',
    identifier: 'seed@example.test',
    value: 'seed-verification-value',
    expires_at: FIXED_TS + 3_600_000,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['passkey', {
    id: 'pk-seed',
    name: 'Seed Key',
    public_key: 'seed-public-key',
    user_id: 'u-seed',
    credential_id: 'seed-credential-id',
    counter: 0,
    device_type: 'singleDevice',
    backed_up: 0,
    transports: 'internal',
    created_at: FIXED_TS,
    aaguid: null,
  }],
  ['rate_limits', {
    key: 'seed:203.0.113.10',
    count: 1,
    window_start: FIXED_TS,
  }],
  ['categories', {
    id: 'cat-seed',
    user_id: 'u-seed',
    name: 'Shelter',
    sort_order: 0,
    created_at: FIXED_TS,
  }],
  ['gear_items', {
    id: 'gear-seed',
    user_id: 'u-seed',
    category_id: 'cat-seed',
    name: 'Seed Tent',
    description: 'A tent that must survive every migration.',
    weight_grams: 1200,
    cost_cents: 45_000,
    purchase_date: '2026-01-15',
    status: 'active',
    sort_order: 0,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  // Second owner's gear. category_id is null: a category belongs to one user,
  // and the composite FK would reject a borrowed one.
  ['gear_items', {
    id: 'gear-seed-2',
    user_id: 'u-seed-2',
    category_id: null,
    name: 'Second Seed Stove',
    description: null,
    weight_grams: 90,
    cost_cents: null,
    purchase_date: null,
    status: 'need_to_buy',
    sort_order: 1,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  // Before lists: lists.food_plan_id points at it from migration 0009 onward.
  ['food_plans', {
    id: 'plan-seed',
    user_id: 'u-seed',
    name: 'Seed Plan',
    sort_order: 0,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  // Second plan, shared by the TIE pair below (list-seed-4/5).
  ['food_plans', {
    id: 'plan-seed-2',
    user_id: 'u-seed',
    name: 'Seed Plan Two',
    sort_order: 1,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['lists', {
    id: 'list-seed',
    user_id: 'u-seed',
    name: 'Seed List',
    description: 'A list that must survive every migration.',
    slug: 'seed01', // lists_slug_shape: exactly 6 characters
    // Dropped automatically while the base ref predates migration 0009, and
    // seeded from then on - so any later rebuild of food_plans has to honour
    // this live NO ACTION reference instead of quietly breaking it.
    food_plan_id: 'plan-seed',
    is_shared: 0,
    group_worn: 0,
    ready_checks_enabled: 0,
    is_draft: 1,
    sort_order: 0,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  // Second owner's list, and the only shared/non-draft one: a migration that
  // copies rows through a filtered SELECT can drop exactly this row while every
  // default-valued row survives. food_plan_id is null - it may not borrow the
  // other user's plan.
  ['lists', {
    id: 'list-seed-2',
    user_id: 'u-seed-2',
    name: 'Second Seed List',
    description: null,
    slug: 'seed02',
    food_plan_id: null,
    is_shared: 1,
    group_worn: 1,
    ready_checks_enabled: 1,
    is_draft: 0,
    sort_order: 1,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  // A second list on the SAME plan as list-seed, updated earlier. Migration
  // 0010's dedupe must detach exactly this one (the most recently updated list
  // wins) - declared in EXPECTED_CHANGES below, which both exempts the rewrite
  // and ASSERTS it happened. Once 0010 is in the base ref this row seeds with
  // its after-value (null) instead, because the unique index would reject the
  // shared link at insert time.
  ['lists', {
    id: 'list-seed-3',
    user_id: 'u-seed',
    name: 'Third Seed List',
    description: null,
    slug: 'seed03',
    food_plan_id: 'plan-seed',
    is_shared: 0,
    group_worn: 0,
    ready_checks_enabled: 0,
    is_draft: 1,
    sort_order: 2,
    created_at: FIXED_TS,
    updated_at: FIXED_TS - 1000,
  }],
  // The TIE pair: both hold plan-seed-2 with IDENTICAL updated_at, so 0010's
  // dedupe must fall through to its id DESC tie-break - 'list-seed-5' wins,
  // 'list-seed-4' is detached (declared in EXPECTED_CHANGES). Identical
  // timestamps are realistic pre-0010 data (two rows written in one db.batch
  // share a Date.now()), and without this pair the tie-break clause could be
  // dropped or reversed with every check still green.
  ['lists', {
    id: 'list-seed-4',
    user_id: 'u-seed',
    name: 'Fourth Seed List',
    description: null,
    slug: 'seed04',
    food_plan_id: 'plan-seed-2',
    is_shared: 0,
    group_worn: 0,
    ready_checks_enabled: 0,
    is_draft: 1,
    sort_order: 3,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['lists', {
    id: 'list-seed-5',
    user_id: 'u-seed',
    name: 'Fifth Seed List',
    description: null,
    slug: 'seed05',
    food_plan_id: 'plan-seed-2',
    is_shared: 0,
    group_worn: 0,
    ready_checks_enabled: 0,
    is_draft: 1,
    sort_order: 4,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  // The row 0009 would have destroyed: it cascades from BOTH lists and
  // gear_items, so it is the canary for any rebuild of either parent.
  ['list_items', {
    id: 'li-seed',
    user_id: 'u-seed',
    list_id: 'list-seed',
    gear_item_id: 'gear-seed',
    quantity: 2,
    is_worn: 0,
    is_consumable: 0, // list_items_worn_xor_consumable
    is_packed: 0,
    is_ready: 0,
    sort_order: 0,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['list_items', {
    id: 'li-seed-2',
    user_id: 'u-seed-2',
    list_id: 'list-seed-2',
    gear_item_id: 'gear-seed-2',
    quantity: 1,
    is_worn: 1, // the other side of list_items_worn_xor_consumable
    is_consumable: 0,
    is_packed: 1,
    is_ready: 1,
    sort_order: 1,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['food_items', {
    id: 'food-seed',
    user_id: 'u-seed',
    name: 'Seed Oatmeal',
    brand: 'Seed Brand',
    serving_description: '1 packet',
    serving_weight_grams: 50, // NOT NULL and > 0
    calories_per_serving: 190,
    servings_per_package: 8,
    fat_grams: 3.5,
    saturated_fat_grams: 0.5,
    carbs_grams: 32,
    fiber_grams: 4,
    sugar_grams: 12,
    protein_grams: 5,
    sodium_mg: 260,
    potassium_mg: 150,
    notes: null,
    sort_order: 0,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  // A by-weight food: servings_per_package null is the load-bearing
  // incomplete-projection signal (design 5.4), and the only nullable-vs-NOT NULL
  // asymmetry in this table. A migration that "tidies" it into NOT NULL would
  // have to drop or rewrite this row.
  ['food_items', {
    id: 'food-seed-2',
    user_id: 'u-seed',
    name: 'Seed Trail Mix',
    brand: null,
    serving_description: null,
    serving_weight_grams: 30,
    calories_per_serving: 145,
    servings_per_package: null,
    fat_grams: null,
    saturated_fat_grams: null,
    carbs_grams: null,
    fiber_grams: null,
    sugar_grams: null,
    protein_grams: null,
    sodium_mg: null,
    potassium_mg: null,
    notes: 'Weighed out, not packaged.',
    sort_order: 1,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['meals', {
    id: 'meal-seed',
    user_id: 'u-seed',
    food_plan_id: 'plan-seed',
    name: 'Breakfast',
    anchor_role: 'breakfast',
    is_default: 1,
    sort_order: 0,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['food_plan_days', {
    id: 'day-seed',
    user_id: 'u-seed',
    food_plan_id: 'plan-seed',
    day_type_override: null,
    sort_order: 0,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['day_meals', {
    id: 'dm-seed',
    user_id: 'u-seed',
    food_plan_id: 'plan-seed',
    day_id: 'day-seed',
    meal_id: 'meal-seed',
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['food_plan_entries', {
    id: 'entry-seed',
    user_id: 'u-seed',
    food_plan_id: 'plan-seed',
    day_meal_id: 'dm-seed',
    is_extra: 0, // food_plan_entries_location_xor
    food_item_id: 'food-seed',
    basis: 'servings',
    amount: 2,
    sort_order: 0,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  // An Extras entry: the other branch of food_plan_entries_location_xor, and the
  // one whose composite (day_meal_id, food_plan_id) FK is NOT enforced because
  // day_meal_id is null. It survives a day_meals rebuild that the cell entry
  // above would not.
  ['food_plan_entries', {
    id: 'entry-seed-extra',
    user_id: 'u-seed',
    food_plan_id: 'plan-seed',
    day_meal_id: null,
    is_extra: 1,
    food_item_id: 'food-seed-2',
    basis: 'packages',
    amount: 1.5,
    sort_order: 1,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  // A packed checkmark (migration 0011): list-seed holds plan-seed, and
  // entry-seed puts food-seed in that plan, so this row satisfies the state
  // rule 2 (reconcile) preserves - a future migration that rebuilds
  // food_pack_state must carry it across unchanged. No id column: the PK is
  // (list_id, food_item_id).
  ['food_pack_state', {
    list_id: 'list-seed',
    food_item_id: 'food-seed',
    user_id: 'u-seed',
    created_at: FIXED_TS,
  }],
]

// Intentional data rewrites. The row-changed check exists to catch ACCIDENTAL
// rewrites, which by design forbids a migration that deliberately rewrites
// data - so a deliberate one is declared here instead, and the check flips
// from "this row must not change" to "this row MUST change exactly like this".
// Each entry names the migration that performs it:
//   - while that migration is NEW on this branch, the fixture seeds `before`
//     and the post-migration snapshot must show `after`;
//   - once it is part of the base ref, the fixture seeds `after` directly
//     (the pre-0010 shared-link state is not even insertable any more).
const EXPECTED_CHANGES = [
  {
    migration: '0010_one-plan-per-list.sql',
    table: 'lists',
    key: { column: 'id', value: 'list-seed-3' },
    column: 'food_plan_id',
    before: 'plan-seed',
    after: null,
  },
  // The tie-break: list-seed-4 and list-seed-5 share plan-seed-2 with equal
  // updated_at, so the dedupe's `id DESC` clause decides - the smaller id
  // loses. (list-seed-5 keeping its link is asserted by the ordinary
  // row-unchanged comparison; only the loser needs declaring.)
  {
    migration: '0010_one-plan-per-list.sql',
    table: 'lists',
    key: { column: 'id', value: 'list-seed-4' },
    column: 'food_plan_id',
    before: 'plan-seed-2',
    after: null,
  },
]

// One-shot probes that run right after the new migrations apply, while the
// migration that motivates them is still on this branch. Later regressions are
// covered elsewhere (listSchemaObjects fails if the index ever vanishes).
const POST_CHECKS = [
  {
    migration: '0010_one-plan-per-list.sql',
    description:
      'lists_food_plan_id_unique rejects a second list on one plan',
    // list-seed still holds plan-seed; re-pointing the (now detached)
    // list-seed-3 at it must hit the partial unique index.
    sql: "update lists set food_plan_id = 'plan-seed' where id = 'list-seed-3'",
    expectErrorMatch: /unique/i,
  },
]

const quoteIdent = (name) => `"${name.replaceAll('"', '""')}"`

const quoteValue = (value) => {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    // NaN/Infinity stringify into something SQLite cannot parse, which would
    // surface as a baffling syntax error rather than a bad fixture.
    if (!Number.isFinite(value)) throw new Error(`Fixture value is not finite: ${value}`)
    return String(value)
  }
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  // Booleans especially: SQLite has no boolean type and these columns are
  // integers, so a stray `true` would silently store the text 'true'.
  throw new Error(`Unsupported fixture value type (${typeof value}): ${String(value)}`)
}

const run = (command, args) => {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    // execFileSync's own message is just the command line. wrangler reports
    // SQL errors as JSON on stdout and everything else on stderr, so surface
    // both or the real reason is invisible.
    const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${command} ${args[0]} ${args[1]} failed:\n${detail || error.message}`)
  }
}

const git = (...args) => run('git', args).trim()

let persistDir = ''

const wrangler = (args) => run('npx', ['wrangler', ...args, '--persist-to', persistDir])

// Runs statements as a file rather than as one --command: D1 caps the number of
// terms in a compound SELECT far below stock SQLite, so 16 tables' worth of
// `union all` is rejected outright. A file returns one result set per
// statement, in order, from a single wrangler invocation.
//
// wrangler prints its banner and warnings to stderr, so stdout is clean JSON.
const execSql = (statements) => {
  if (statements.length === 0) return []
  const path = join(persistDir, 'query.sql')
  writeFileSync(path, `${statements.join(';\n')};\n`)
  const raw = wrangler(['d1', 'execute', DB, '--local', '--json', '--file', path])
  return JSON.parse(raw).map((result) => result.results)
}

const query = (sql) => execSql([sql])[0]

// Runs a statement that MUST fail, returning null on the expected rejection
// and a failure description otherwise. wrangler reports D1's SQL errors on
// stdout and run() folds both streams into the thrown message, so the pattern
// can match either.
const expectSqlError = (statement, pattern) => {
  try {
    execSql([statement])
  } catch (error) {
    if (pattern.test(error.message)) return null
    return `failed with the wrong error:\n${error.message}`
  }
  return 'succeeded, but should have been rejected'
}

// The before-snapshot, rewritten to what it SHOULD look like after the new
// migrations: every EXPECTED_CHANGES entry whose migration is in this branch's
// new set is applied to its row. Comparing this against the real
// after-snapshot both exempts the declared rewrite and asserts it happened.
const applyExpectedChanges = (before, newMigrations) => {
  const active = EXPECTED_CHANGES.filter((c) => newMigrations.has(c.migration))
  if (active.length === 0) return before

  const expected = new Map()
  for (const [table, rows] of before) {
    const changes = active.filter((c) => c.table === table)
    if (changes.length === 0) {
      expected.set(table, rows)
      continue
    }
    const rewritten = rows.map((json) => {
      const row = JSON.parse(json)
      let modified = false
      for (const change of changes) {
        if (row[change.key.column] === change.key.value) {
          if (!(change.column in row)) {
            throw new Error(
              `EXPECTED_CHANGES names ${table}.${change.column}, which the ` +
                'snapshot does not contain.',
            )
          }
          row[change.column] = change.after
          modified = true
        }
      }
      // Untouched rows keep SQLite's own JSON rendering, so a JS-vs-SQLite
      // formatting difference can never masquerade as a data change.
      return modified ? JSON.stringify(row) : json
    })
    // Re-sort: the rewrite can change the rows' relative string order.
    expected.set(table, [...rewritten].sort())
  }
  return expected
}

const applyMigrations = () => wrangler(['d1', 'migrations', 'apply', DB, '--local'])

const listTables = () =>
  query(`select m.name from sqlite_master m where ${appTablesFilter('m')}`).map(
    (row) => row.name,
  )

// Triggers and named indexes on our own tables. A table rebuild drops these
// along with the old table, and drizzle-kit cannot regenerate the hand-written
// ones because they are not in its snapshot - which is exactly how the
// `lists_user_cap` trigger nearly vanished in migration 0009. Implicit
// sqlite_autoindex_* entries are excluded: they are recreated automatically and
// their numbering is not stable across a rebuild.
const listSchemaObjects = () =>
  query(
    "select m.type, m.name from sqlite_master m where m.type in ('trigger', 'index') " +
      "and m.name not glob 'sqlite_*' and m.tbl_name not glob 'sqlite_*' " +
      "and m.tbl_name not glob '_cf_*' and m.tbl_name <> 'd1_migrations'",
  ).map(({ type, name }) => `${type} ${name}`)

// Maps table -> Set of column names, as the schema actually stands right now.
const describeColumns = () => {
  const rows = query(
    'select m.name as tbl, p.name as col from sqlite_master m ' +
      `join pragma_table_info(m.name) p where ${appTablesFilter('m')}`,
  )
  const byTable = new Map()
  for (const { tbl, col } of rows) {
    if (!byTable.has(tbl)) byTable.set(tbl, new Set())
    byTable.get(tbl).add(col)
  }
  return byTable
}

// Drops fixture columns the base ref does not have yet, so a fixture can be
// written against the post-migration schema. `newMigrations` decides which
// side of each EXPECTED_CHANGES entry to seed (see that constant).
const seed = (columnsByTable, newMigrations) => {
  const seededColumns = new Map()
  const inserts = []

  for (const [table, fixtureRow] of FIXTURES) {
    const existing = columnsByTable.get(table)
    if (!existing) continue // table arrives in one of the new migrations

    const row = { ...fixtureRow }
    for (const change of EXPECTED_CHANGES) {
      if (change.table !== table) continue
      if (row[change.key.column] !== change.key.value) continue
      row[change.column] = newMigrations.has(change.migration)
        ? change.before
        : change.after
    }

    const columns = Object.keys(row).filter((col) => existing.has(col))
    if (columns.length === 0) continue

    const previous = seededColumns.get(table)
    if (previous && previous.join() !== columns.join()) {
      throw new Error(
        `Fixture rows for ${table} declare different columns. Every row for a ` +
          'table must set the same keys (use an explicit null), or the snapshot ' +
          'would compare different columns for different rows.',
      )
    }

    const columnList = columns.map(quoteIdent).join(', ')
    const valueList = columns.map((col) => quoteValue(row[col])).join(', ')
    inserts.push(
      `insert into ${quoteIdent(table)} (${columnList}) values (${valueList})`,
    )
    seededColumns.set(table, columns)
  }

  execSql(inserts)
  return seededColumns
}

// Every seeded row, as JSON, keyed by table. Reads only the columns that
// existed before the migration: new columns are expected to differ, old ones
// are not allowed to.
const snapshot = (seededColumns) => {
  const tables = [...seededColumns.keys()]
  const selects = tables.map((table) => {
    const pairs = seededColumns
      .get(table)
      .map((col) => `'${col}', ${quoteIdent(col)}`)
      .join(', ')
    return `select json_object(${pairs}) as row from ${quoteIdent(table)}`
  })

  const resultSets = execSql(selects)
  return new Map(
    tables.map((table, i) => [
      table,
      // Sorted so the comparison does not depend on row order.
      resultSets[i].map(({ row }) => row).sort(),
    ]),
  )
}

const main = () => {
  const baseArg = process.argv.find((arg) => arg.startsWith('--base='))
  const base = baseArg ? baseArg.slice('--base='.length) : 'origin/main'

  // Status letter + path for every migration touched since the base ref.
  const changed = git(
    'diff',
    '--name-status',
    `${base}...HEAD`,
    '--',
    `${MIGRATIONS_DIR}/*.sql`,
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split('\t')
      return { status: status[0], path: paths[paths.length - 1] }
    })

  // Fail closed on anything but a pure addition. Production has ALREADY run the
  // old text of an existing migration and wrangler tracks it as applied by
  // name, so editing, deleting or renaming one is silently a no-op there while
  // this check would build a base schema from a history that never existed.
  const rewritten = changed.filter((file) => file.status !== 'A')
  if (rewritten.length > 0) {
    throw new Error(
      'Existing migrations were modified, deleted or renamed:\n' +
        rewritten.map((f) => `  - ${f.status} ${f.path}`).join('\n') +
        '\n\nProduction has already applied these by name and will never re-run ' +
        'them, so the change reaches no deployed database. Add a NEW migration ' +
        'instead.',
    )
  }

  const added = changed.map((file) => file.path)
  const addedNames = new Set(added.map((file) => basename(file)))

  if (added.length === 0) {
    console.log(`No migrations added since ${base}. Nothing to check.`)
    return
  }

  console.log(`Migrations added since ${base}:`)
  for (const file of added) console.log(`  ${file}`)

  persistDir = mkdtempSync(join(tmpdir(), 'migration-safety-'))

  // The new migrations have to leave the directory for the base-schema pass, so
  // they are held in memory AND copied to disk first. The disk copy is what
  // survives a SIGKILL or a crash, where `finally` never runs - and it matters
  // because an uncommitted migration edit exists nowhere else, so
  // `git checkout -- migrations/` would restore the committed text over it.
  // (Copied, not renamed: the temp dir is usually another filesystem, and
  // rename across one gives EXDEV.)
  const backupDir = mkdtempSync(join(tmpdir(), 'migration-safety-backup-'))
  const held = new Map(added.map((file) => [file, readFileSync(file, 'utf8')]))
  for (const [file, contents] of held) {
    writeFileSync(join(backupDir, basename(file)), contents)
  }

  const restore = () => {
    for (const [file, contents] of held) writeFileSync(file, contents)
  }

  // Ctrl-C exits without running `finally`, which would leave the working tree
  // missing tracked migration files.
  const onSignal = () => {
    restore()
    process.exit(130)
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  try {
    // 1. Rewind to the base ref's migrations by taking the new files away.
    for (const file of held.keys()) rmSync(file)

    console.log(`\nApplying migrations as of ${base}...`)
    applyMigrations()

    // 2. Make the database look like production.
    const columnsByTable = describeColumns()
    if (columnsByTable.size === 0) {
      console.log(`\nNo tables exist as of ${base}; there is no data to preserve.`)
      return
    }

    const seededColumns = seed(columnsByTable, addedNames)

    const unseeded = listTables().filter((table) => !seededColumns.has(table))
    if (unseeded.length > 0) {
      throw new Error(
        `No fixture for: ${unseeded.join(', ')}.\n` +
          'Every table needs a fixture row in scripts/check-migration-safety.mjs, ' +
          'or this check would silently skip it. Add one.',
      )
    }

    const before = snapshot(seededColumns)
    const schemaBefore = listSchemaObjects()
    const seededRows = [...before.values()].reduce((n, rows) => n + rows.length, 0)
    console.log(`Seeded ${seededRows} rows across ${before.size} tables.`)

    // 3. Apply the new migrations, exactly as deploy.yml does in production.
    for (const [file, contents] of held) writeFileSync(file, contents)

    console.log('\nApplying the new migrations...')
    applyMigrations()

    // 4. Nothing may have been lost or corrupted - except the rewrites the
    // new migrations DECLARED, which must have happened exactly as declared.
    const after = snapshot(seededColumns)
    const failures = []
    const expected = applyExpectedChanges(before, addedNames)

    for (const [table, beforeRows] of expected) {
      const afterRows = after.get(table) ?? []
      if (afterRows.length !== beforeRows.length) {
        failures.push(
          `${table}: ${beforeRows.length} row(s) before, ${afterRows.length} after` +
            (afterRows.length === 0 ? ' - every row was destroyed' : ''),
        )
        continue
      }
      for (const [i, beforeRow] of beforeRows.entries()) {
        if (afterRows[i] !== beforeRow) {
          failures.push(`${table}: a row changed value\n  before: ${beforeRow}\n  after:  ${afterRows[i]}`)
        }
      }
    }

    // Triggers and indexes that a rebuild dropped and never put back.
    const schemaAfter = new Set(listSchemaObjects())
    const dropped = schemaBefore.filter((object) => !schemaAfter.has(object))
    if (dropped.length > 0) {
      failures.push(
        `Dropped and never recreated: ${dropped.join(', ')}. ` +
          'A table rebuild drops the table\'s triggers and indexes; hand-written ' +
          'ones are not in the drizzle snapshot, so the migration must recreate ' +
          'them explicitly.',
      )
    }

    // One-shot probes for the migrations this branch introduces. Run AFTER the
    // snapshots so a probe that unexpectedly succeeds cannot contaminate the
    // row comparison above.
    for (const check of POST_CHECKS) {
      if (!addedNames.has(check.migration)) continue
      const problem = expectSqlError(check.sql, check.expectErrorMatch)
      if (problem) {
        failures.push(`Post-check "${check.description}" ${problem}`)
      }
    }

    const tablesAfter = listTables()
    const scratch = tablesAfter.filter(isScratchTable)
    if (scratch.length > 0) {
      failures.push(
        `Scratch table(s) left behind: ${scratch.join(', ')}. ` +
          'A table rebuild must drop its scratch table before finishing.',
      )
    }

    // New tables hold no data yet, so nothing can be lost from them THIS time -
    // but without a fixture they would be invisible to every future run. Demand
    // one now, while the table is fresh in the author's mind.
    const fixtureTables = new Set(FIXTURES.map(([table]) => table))
    const missingFixture = tablesAfter.filter(
      (table) => !isScratchTable(table) && !fixtureTables.has(table),
    )
    if (missingFixture.length > 0) {
      failures.push(
        `New table(s) with no fixture: ${missingFixture.join(', ')}. ` +
          'Add a fixture row to scripts/check-migration-safety.mjs, or no future ' +
          'migration will ever be checked against them.',
      )
    }

    if (failures.length > 0) {
      throw new Error(
        'These migrations are NOT safe to apply to production:\n\n' +
          failures.map((f) => `  - ${f}`).join('\n') +
          '\n\nA migration that rebuilds a table must back up child rows before ' +
          'DROP TABLE and restore them after. PRAGMA foreign_keys=OFF does NOT ' +
          'protect you on D1 - see AGENTS.md.',
      )
    }

    console.log(`\nOK: all ${seededRows} seeded rows survived intact.`)
  } finally {
    restore()
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    rmSync(persistDir, { recursive: true, force: true })
    rmSync(backupDir, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  console.error(`\n${error.message}`)
  process.exit(1)
}
