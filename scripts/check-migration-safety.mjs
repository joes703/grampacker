#!/usr/bin/env node
// Proves that every D1 migration added since the frozen baseline preserves the
// data that existed before it.
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
//   1. Applies the FROZEN BASELINE - the 21 migrations that predate this gate,
//      pinned by digest below - to a throwaway local D1.
//   2. Seeds one row into every table, so the database looks like production
//      rather than like a fresh install.
//   3. Applies every post-baseline migration - the same `wrangler d1 migrations
//      apply` code path deploy.yml runs against production, pointed at a
//      staged copy of the directory rather than the tracked one.
//   4. Asserts every seeded row still exists AND still holds the same values
//      in every column that existed beforehand.
//
// "Post-baseline" is computed from the migrations DIRECTORY, never from a git
// diff, and that distinction is load-bearing. A diff-scoped version washed
// through: push A adds a migration that destroys rows, this check goes red and A
// never deploys; push B changes no SQL, so the diff is empty and the check
// reports nothing to do; B goes green, and B's deploy applies every PENDING
// migration - A's included. Anchoring to the baseline means a bad migration is
// re-tested on every run for as long as it exists.
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
//   - It cannot tell you whether an EDIT to a post-baseline migration ever
//     reached production. The baseline itself is digest-pinned, so editing one
//     of those 21 fails closed forever. Post-baseline files have no such pin:
//     the edited text is fully re-tested, but wrangler tracks migrations by
//     NAME, so if the old text already ran in production the edit silently
//     reaches no deployed database. Closing that needs a record of what
//     production actually applied - the same problem Phase 3's manifest solves
//     (docs/review-remediation-plan.md). Until then: never edit a migration
//     that has shipped, and note this check will not catch you.
//
// MAINTENANCE
// -----------
// Adding a table? Add a fixture row below - the script fails on any table it
// finds without one, so coverage cannot silently rot. A table may have several
// fixture rows, and all of them must set the same keys. Fixture columns that do
// not exist yet at the point being tested are dropped automatically, so a
// fixture may be written against the schema as it looks AFTER your migration.
//
// Writing a migration that DELIBERATELY rewrites data? Declare each rewrite in
// EXPECTED_CHANGES (and, if it also needs a constraint proven, a POST_CHECKS
// probe) - the row-changed failure flips into an assertion that the rewrite
// happened exactly as declared.
//
// Writing a migration that REBUILDS or RENAMES anything? You cannot, and no
// declaration lets you - a rebuild's DROP TABLE cascade-wipes children on D1.
// That also means a column TYPE or CHECK change is out, since SQLite can only
// do one through a rebuild.
//
// REMOVING a column, trigger or index - or a table nothing cascades from - is
// allowed as a CONTRACT STEP one release after the code that read it stopped
// shipping. Declare it in CONTRACT_MIGRATIONS: the gate then matches the SQL
// against the declaration statement by statement, refuses a cascade parent by
// reading incoming foreign keys off the live schema, and refuses a column that
// server/db/app-schema.ts or a raw sql`` fragment still names. It CANNOT prove
// the earlier release reached production - that part is attested, not checked.
//
// DROPPED_TABLES, DROPPED_COLUMNS, DROPPED_SCHEMA_OBJECTS and
// EXPECTED_TYPE_CHANGES are FROZEN HISTORY. They describe migrations that
// already shipped. Each only ever activates for a POST-BASELINE migration, and
// every entry names a baseline one, so none of them can fire. Do not add
// entries: the gate rejects the migrations they would describe, so an entry can
// no longer excuse anything - it only looks like it can.
//
// HOW IT TALKS TO D1
// ------------------
// Every statement runs against local D1 through `wrangler d1 execute --local`,
// including the ones that only read. Nothing here uses a second SQLite: the
// probes below are the only behavioral coverage of trigger bodies this repo
// has, and running them on another engine would prove something about that
// engine instead.
//
// What it does NOT do is pay a process launch per statement. Reads that observe
// the same database state ride one launch (batchReadSql), which is why a pass
// makes five read launches rather than twenty. Writes never share a launch:
// fixture seeding, every POST_CHECKS probe and every migration apply get their
// own, because their individual failure text IS the assertion.
//
// Each pass stages the migrations it should see into a throwaway directory
// beside a generated wrangler config. The tracked `migrations/` tree is only
// ever read - hashed by contents before and after the run to prove it.
//
// Usage: node scripts/check-migration-safety.mjs
//
// Takes no arguments and reads no git state - what it checks is determined
// entirely by the contents of the migrations directory.

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, posix, relative } from 'node:path'

const DB = 'grampacker'
const MIGRATIONS_DIR = 'migrations'

// Wrangler's record of which migrations have already run. Excluded from every
// snapshot below (it is bookkeeping, not app data), which is exactly why the
// classifier has to refuse migrations that write to it - nothing here would see
// the damage.
const LEDGER_TABLE = 'd1_migrations'

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

// NOTE on pack_sort_order: these values are explicit, and must stay that way.
// They were originally omitted so that 0018's backfill would assign them, and
// a 0018 probe asserted the result. That worked only while 0018 was the
// migration UNDER TEST. Now that 0018 is in the frozen baseline, the fixtures
// are seeded into a schema that already carries its two unique indexes, so
// rows defaulting to 0 in the same cohort collide - and the seed fails before
// any new migration is even applied. The values below are exactly what the
// 0018 backfill produced (each cohort ranked from 0, independently), so the
// seeded state is the one production actually holds.
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
    // Added by 0028 (better-auth 1.7), which requires `account` to be EMPTY
    // when it runs (REQUIRE_EMPTY_TABLE), so 0028's own pass does not seed
    // this row at all. Every later pass does, and this is the namespace 1.7
    // stores for a credential account (createLocalAccountIssuer).
    issuer: 'local:credential',
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
  ['lists', {
    id: 'list-seed',
    user_id: 'u-seed',
    name: 'Seed List',
    description: 'A list that must survive every migration.',
    slug: 'seed01', // lists_slug_shape: exactly 6 characters
    // Dropped automatically while the tested schema predates migration 0009, and
    // seeded from then on - so any later rebuild of food_plans has to honor
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
  // and ASSERTS it happened. Now that 0010 is in the frozen baseline this row seeds with
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
  // Food estimate (0017). Slots are the trip's eating periods; items are what
  // you CARRY; the association expresses intent only and is never summed.
  //
  // One item is associated with a slot; a SECOND slot sits at needed=0 and
  // deliberately holds nothing, because "skipped but still holding food" is a
  // state the schema forbids (see the needed_only trigger).
  //
  // That second row USED to guard against a migration resetting `needed` to 1
  // and silently re-adding meals the user said they were not eating. Migration
  // 0026 does exactly that, deliberately: the Skip feature is gone, so a row at
  // 0 is now unusable rather than meaningful. The row survives as the fixture
  // that PROVES 0026's repair, declared in EXPECTED_CHANGES.
  //
  // What this still guards is a future migration DELETING or REWRITING
  // association rows. It does NOT catch a future migration adding a weight
  // column to the association table: the guard deliberately excludes new
  // columns from comparison, so a wrong sum introduced that way has to be
  // caught by tests, not here.
  ['list_food_slots', {
    id: 'lfs-seed',
    user_id: 'u-seed',
    list_id: 'list-seed',
    day_number: 1,
    meal: 'breakfast',
    needed: 1,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['list_food_slots', {
    id: 'lfs-seed-2',
    user_id: 'u-seed',
    list_id: 'list-seed',
    day_number: 1,
    meal: 'lunch',
    // Seeded at 0 so 0026's backfill has something to repair, and so the
    // repair is asserted rather than assumed. This used to guard the opposite
    // invariant - that a pruned meal survives a migration - which 0026
    // deliberately retires along with the feature that created such rows.
    needed: 0,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['list_food_items', {
    id: 'lfi-seed',
    user_id: 'u-seed',
    list_id: 'list-seed',
    name: 'Seed Trail Mix',
    weight_grams: 500,
    quantity: 1,
    sort_order: 0,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  // 0022's backfill canaries, the 0018 pattern one table over. Pre-0022 no
  // food row can carry a location, so the only partition boundary the
  // backfill can be wrong about is the LIST: these give list-seed three food
  // rows with gapped sort_order in non-insertion order, and list-seed-3 one
  // row with a large sort_order, so the post-check can pin that ranks follow
  // sort_order (not insertion, not a copy of sort_order's values) and start
  // at 0 per list (not globally).
  //
  // Deliberately NOT carrying the 0022 columns: they do not exist at fixture
  // time in 0022's own pass. That is the point - these rows are what the
  // migration has to rank.
  ['list_food_items', {
    id: 'lfi-canary-b',
    user_id: 'u-seed',
    list_id: 'list-seed',
    name: 'Canary Jerky',
    weight_grams: 200,
    quantity: 1,
    sort_order: 20,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['list_food_items', {
    id: 'lfi-canary-c',
    user_id: 'u-seed',
    list_id: 'list-seed',
    name: 'Canary Oats',
    weight_grams: 300,
    quantity: 2,
    sort_order: 5,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['list_food_items', {
    id: 'lfi-other-list',
    user_id: 'u-seed',
    list_id: 'list-seed-3',
    name: 'Other-List Bars',
    weight_grams: 400,
    quantity: 1,
    sort_order: 50,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['list_food_item_slots', {
    food_item_id: 'lfi-seed',
    slot_id: 'lfs-seed',
    user_id: 'u-seed',
    list_id: 'list-seed',
  }],
  ['packing_locations', {
    id: 'pl-seed',
    user_id: 'u-seed',
    list_id: 'list-seed',
    name: 'Seed Location',
    sort_order: 0,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
['packing_locations', {
    id: 'pl-seed-exhausted',
    user_id: 'u-seed',
    list_id: 'list-seed',
    name: 'Exhausted Location',
    sort_order: 0,
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
    packing_location_id: null,
    pack_sort_order: 0,
    sort_order: 0,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  // 0018's backfill canaries. The existing seeds are one row per list, so a
  // list-wide implementation of pack_sort_order would satisfy a contiguity
  // check just as well as a per-cohort one. These give ONE list two cohorts -
  // two rows on pl-seed and two unassigned - with interleaved and gapped
  // document ranks, so the post-check below can pin exact per-cohort values.
  //
  // Deliberately pre-migration rows and NOT carrying pack_sort_order: the
  // column does not exist yet at fixture time. That is the point - they are
  // what the migration has to rank.
  ['list_items', {
    id: 'li-cohort-a1',
    user_id: 'u-seed',
    list_id: 'list-seed',
    gear_item_id: 'gear-seed',
    quantity: 1,
    is_worn: 0,
    is_consumable: 0,
    is_packed: 0,
    is_ready: 0,
    packing_location_id: 'pl-seed',
    pack_sort_order: 1,
    sort_order: 40,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['list_items', {
    id: 'li-cohort-a2',
    user_id: 'u-seed',
    list_id: 'list-seed',
    gear_item_id: 'gear-seed',
    quantity: 1,
    is_worn: 0,
    is_consumable: 0,
    is_packed: 0,
    is_ready: 0,
    packing_location_id: 'pl-seed',
    pack_sort_order: 0,
    sort_order: 10,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['list_items', {
    id: 'li-cohort-u1',
    user_id: 'u-seed',
    list_id: 'list-seed',
    gear_item_id: 'gear-seed',
    quantity: 1,
    is_worn: 0,
    is_consumable: 0,
    is_packed: 0,
    is_ready: 0,
    packing_location_id: null,
    pack_sort_order: 1,
    sort_order: 30,
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
    packing_location_id: null,
    pack_sort_order: 0,
    sort_order: 1,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  // Two rows in ONE cohort on their own list, seeded AT and ABOVE
  // PACK_RANK_MAX - the exact legacy state 0019 has to repair. Before this
  // release the import endpoint copied sort_order straight into
  // pack_sort_order and importListItemSchema permits 1000000000, so this is
  // reachable production data rather than a synthetic case. 0019 renumbers the
  // cohort densely; the rewrite is declared in EXPECTED_CHANGES.
  ['list_items', {
    id: 'li-exhausted-a',
    user_id: 'u-seed',
    list_id: 'list-seed',
    gear_item_id: 'gear-seed',
    quantity: 1,
    is_worn: 0,
    is_consumable: 0,
    is_packed: 0,
    is_ready: 0,
    packing_location_id: 'pl-seed-exhausted',
    pack_sort_order: 1000000000,
    sort_order: 90,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['list_items', {
    id: 'li-exhausted-b',
    user_id: 'u-seed',
    list_id: 'list-seed',
    gear_item_id: 'gear-seed',
    quantity: 1,
    is_worn: 0,
    is_consumable: 0,
    is_packed: 0,
    is_ready: 0,
    packing_location_id: 'pl-seed-exhausted',
    pack_sort_order: 1000000005,
    sort_order: 91,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  // Codex's near-ceiling case: an Unassigned row one BELOW PACK_RANK_MAX, so
  // it passes any "is the rank in range" test, plus a two-item location.
  // Deleting that location appends orphans at base+i = 1000000000 and
  // 1000000001, and the second overflows. Legal legacy data that the narrower
  // >= PACK_RANK_MAX predicate accepted and left wedged.
  ['list_items', {
    id: 'li-nearceiling-u',
    user_id: 'u-seed',
    list_id: 'list-seed-3',
    gear_item_id: 'gear-seed',
    quantity: 1,
    is_worn: 0,
    is_consumable: 0,
    is_packed: 0,
    is_ready: 0,
    packing_location_id: null,
    pack_sort_order: 999999999,
    sort_order: 95,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
]

// Intentional data rewrites. The row-changed check exists to catch ACCIDENTAL
// rewrites, which by design forbids a migration that deliberately rewrites
// data - so a deliberate one is declared here instead, and the check flips
// from "this row must not change" to "this row MUST change exactly like this".
// Each entry names the migration that performs it:
//   - in the pass testing that migration, the fixture seeds `before` and the
//     post-migration snapshot must show `after`;
//   - in the pass for any LATER migration it has already run, so the fixture
//     seeds `after` directly (the pre-0010 shared-link state is not even
//     insertable any more). Entries naming a baseline migration are always in
//     this second case.
const EXPECTED_CHANGES = [
  // 0026 makes every meal slot usable again. `needed` backed a "Nothing
  // planned" warning and the Skip button that silenced it; both were removed
  // one release earlier, along with all three writers (the PATCH route,
  // setSlotNeeded, and the copy in list duplication). The rows they left at 0
  // are hostile rather than stale - the 0017 needed_only trigger refuses to
  // schedule food into them, and no control exists any more to clear the flag.
  //
  // lfs-seed-2 is the fixture that proves it. It was seeded at 0 specifically
  // so a rebuild could not silently re-add a pruned meal; that invariant is
  // deliberately RETIRED here, which is why the change has to be declared
  // rather than merely allowed.
  {
    migration: '0026_food_needed_backfill.sql',
    table: 'list_food_slots',
    key: { column: 'id', value: 'lfs-seed-2' },
    column: 'needed',
    before: 0,
    after: 1,
  },
  // Food pack ranks, seeded per-pass because 0023 changes what is even
  // INSERTABLE. Before 0023 the fixtures' three list-seed food rows all sit at
  // rank 0 - the dirty old-worker state 0023's repair exists to renumber, and
  // what its POST_CHECKS assert. From 0023 on, the unassigned uniqueness index
  // exists and seeding three rows at 0 is rejected outright, so every LATER
  // migration's pass has to seed the repaired ranks instead. Declaring the
  // values here is what keeps 0023's own pass dirty and 0024's pass legal.
  //
  // The `after` values are exactly 0023's repair output (see its POST_CHECKS):
  // list-seed's Unassigned gear maximum is 1, its three food rows order by
  // sort_order 0, 5, 20 -> ranks 2, 3, 4. list-seed-3's lone row was never
  // dirty and keeps 0.
  {
    migration: '0023_food-pack-rank-enforcement.sql',
    table: 'list_food_items',
    key: { column: 'id', value: 'lfi-seed' },
    column: 'pack_sort_order',
    before: 0,
    after: 2,
  },
  {
    migration: '0023_food-pack-rank-enforcement.sql',
    table: 'list_food_items',
    key: { column: 'id', value: 'lfi-canary-c' },
    column: 'pack_sort_order',
    before: 0,
    after: 3,
  },
  {
    migration: '0023_food-pack-rank-enforcement.sql',
    table: 'list_food_items',
    key: { column: 'id', value: 'lfi-canary-b' },
    column: 'pack_sort_order',
    before: 0,
    after: 4,
  },
  {
    migration: '0023_food-pack-rank-enforcement.sql',
    table: 'list_food_items',
    key: { column: 'id', value: 'lfi-other-list' },
    column: 'pack_sort_order',
    before: 0,
    after: 0,
  },
  // 0019 densely renumbers only cohorts whose maximum is at or above
  // PACK_RANK_MAX. These two are the whole point: without the repair they
  // would survive the migration and permanently refuse arrivals, moves, and
  // location deletion, because every arrival computes max+1 and the new
  // trigger rejects it. Clean cohorts elsewhere in the fixtures must be
  // UNCHANGED, which the ordinary row comparison asserts for free.
  {
    migration: '0019_pack-rank-guard.sql',
    table: 'list_items',
    key: { column: 'id', value: 'li-exhausted-a' },
    column: 'pack_sort_order',
    before: 1000000000,
    after: 0,
  },
  {
    migration: '0019_pack-rank-guard.sql',
    table: 'list_items',
    key: { column: 'id', value: 'li-exhausted-b' },
    column: 'pack_sort_order',
    before: 1000000005,
    after: 1,
  },
  // In range, but with no headroom for a location deletion's base+i append.
  {
    migration: '0019_pack-rank-guard.sql',
    table: 'list_items',
    key: { column: 'id', value: 'li-nearceiling-u' },
    column: 'pack_sort_order',
    before: 999999999,
    after: 0,
  },
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

// Tables 0016 dropped. Keyed by the migration that dropped them, so the entry
// only ever applied in that migration's own pass; 0016 is in the frozen
// baseline, so the table is simply absent and needs no fixture at all.
// FROZEN HISTORY - do not add entries. Every one below is from 0016, which
// shipped long ago, and each consumer only activates for a POST-BASELINE
// migration. The destructive-DDL gate now rejects any such migration, so
// a new entry here could not excuse a drop even if you added one. Kept because
// they document what 0016 actually did.
const DROPPED_TABLES = [
  { migration: '0016_remove-food-planning.sql', table: 'day_meals' },
  { migration: '0016_remove-food-planning.sql', table: 'food_items' },
  { migration: '0016_remove-food-planning.sql', table: 'food_pack_state' },
  { migration: '0016_remove-food-planning.sql', table: 'food_plan_daily_targets' },
  { migration: '0016_remove-food-planning.sql', table: 'food_plan_days' },
  { migration: '0016_remove-food-planning.sql', table: 'food_plan_entries' },
  { migration: '0016_remove-food-planning.sql', table: 'food_plan_target_defaults' },
  { migration: '0016_remove-food-planning.sql', table: 'food_plans' },
  { migration: '0016_remove-food-planning.sql', table: 'meal_targets' },
  { migration: '0016_remove-food-planning.sql', table: 'meals' },
]

// Tables that exist only DURING a statement and are correct only when EMPTY.
//
// The fixture requirement below demands a seeded row for every new table, which
// is right for real tables and wrong for these: seeding one asserts a state that
// can never persist, and keying that seed to another fixture risks a primary-key
// collision. Renaming them to a `__` prefix does not help either - they would
// then trip the scratch-table check instead. Both naming options fail, so the
// mechanism has to be explicit.
//
// The exemption is deliberately NARROW. An entry is excused only from needing a
// seeded row; it is still required to EXIST and required to be EMPTY after
// migration. Every other table's fixture, and all the rebuild/cascade detection
// that is this script's whole purpose, is untouched - so a future migration that
// rebuilt `list_items` would still be caught by `list_items`' own fixture rather
// than hidden by anything here.
const TRANSIENT_TABLES = [
  {
    migration: '0019_pack-rank-guard.sql',
    table: '_pack_reorder_guard',
    why: "reorderPack's fail-loud CAS guard; a row lives only between park and settle",
  },
  {
    migration: '0020_cascade-rerank.sql',
    table: '_packing_location_delete_state',
    why: 'the cascade re-rank mapping; rows live only inside the delete trigger',
  },
  {
    migration: '0022_food-pack-state.sql',
    table: '_food_pack_reorder_guard',
    why: "the food half of a union pack reorder's fail-loud guard; a row lives only between park and settle",
  },
  {
    migration: '0022_food-pack-state.sql',
    table: '_food_location_delete_state',
    why: 'the food cascade re-rank mapping; rows live only inside the delete trigger',
  },
  {
    migration: '0023_food-pack-rank-enforcement.sql',
    table: '_food_rank_repair',
    why: "0023's one-shot repair mapping; emptied by the same migration and dropped by the 0027 contract step, so this entry only applies to passes before 0027",
  },
]

// Migrations whose DDL is legal only on an EMPTY table, and which therefore
// REFUSE a populated one - by design, not by accident. SQLite accepts
// `ADD COLUMN ... NOT NULL` with no default only while the table has no rows,
// a default once added can never be dropped, and the rebuild that could do
// either is banned. So a migration that must leave a column exactly as the
// Drizzle snapshot declares it (NOT NULL, no default) has one honest form:
// the generated statement, on an empty table, failing closed otherwise.
//
// The pass for such a migration does NOT seed the named table - seeding it
// would fail the apply for the reason the migration exists - and its
// POST_CHECKS prove the schema it leaves behind. The table is still seeded
// in every other pass, so a later rebuild of it is caught as usual, and its
// fixture must still carry every column the newest schema has.
//
// What this does NOT prove: that production's table is empty when the deploy
// runs. That is a human attestation (a remote count before merge); the
// migration's refusal is what keeps a wrong attestation from costing anything
// beyond a halted deploy.
const REQUIRE_EMPTY_TABLE = [
  {
    migration: '0028_better_auth_1_7_account_issuer.sql',
    table: 'account',
    why: "better-auth 1.7's required account.issuer added without a default; this app has no writers of account and production held zero rows on 2026-09-04",
  },
]

// Columns 0016 dropped, and the schema objects that went with them. Indexes and
// triggers belonging to a DROPPED_TABLES entry are exempt automatically (the
// table took them); this list is for objects on tables that SURVIVED, where a
// silently vanished index would be a real regression.
//
// FROZEN HISTORY - do not add entries. See DROPPED_TABLES above.
const DROPPED_COLUMNS = [
  { migration: '0016_remove-food-planning.sql', table: 'lists', column: 'food_plan_id' },
]

const DROPPED_SCHEMA_OBJECTS = [
  { migration: '0016_remove-food-planning.sql', object: 'index lists_food_plan_id_unique' },
]

// Column type changes 0013 made. Anything not listed here that changes type
// fails the run: an unintended rebuild that widens a column is exactly the
// silent corruption this script exists to catch, and canonicalize() means the
// value comparison can no longer see it.
//
// FROZEN HISTORY - do not add entries. SQLite changes a column type only via a
// table rebuild, which the destructive-DDL gate rejects.
const EXPECTED_TYPE_CHANGES = [
  {
    migration: '0013_gear-weight-real.sql',
    column: 'gear_items.weight_grams',
    from: 'INTEGER',
    to: 'REAL',
  },
]

// Probes that run right after the migration that motivates them applies, for as
// long as that migration is post-baseline. Later regressions are covered
// elsewhere (listSchemaObjects fails if the index ever vanishes).
const POST_CHECKS = [
  // 0022: food pack state (the EXPAND half; enforcement checks live on
  // 0023's entries). The backfill pin mirrors 0018's gear backfill (each
  // cohort ranked from 0 by sort_order), with the 0022 twist:
  // food ranks are OFFSET past each list's Unassigned gear maximum, so the
  // union display reads "food appended after gear". list-seed's Unassigned
  // gear holds ranks 0 and 1 (li-seed, li-cohort-u1), so its food ordered by
  // sort_order lands at: lfi-seed (0) -> 2, lfi-canary-c (5) -> 3,
  // lfi-canary-b (20) -> 4. list-seed-3's Unassigned gear max is 0
  // (li-nearceiling-u after 0019's normalize), so lfi-other-list -> 1 -
  // proving per-list partitioning AND the per-list offset in one row.
  { migration: '0022_food-pack-state.sql', description: 'food backfill offsets each list past its gear maximum',
    sql: "select id, pack_sort_order as rank from list_food_items where id in ('lfi-seed','lfi-canary-b','lfi-canary-c','lfi-other-list') order by id",
    expectRows: [
      { id: 'lfi-canary-b', rank: 4 },
      { id: 'lfi-canary-c', rank: 3 },
      { id: 'lfi-other-list', rank: 1 },
      { id: 'lfi-seed', rank: 2 },
    ] },
  { migration: '0022_food-pack-state.sql', description: 'no committed food rank is negative',
    sql: "select count(*) as negatives from list_food_items where pack_sort_order < 0",
    expectRows: [{ negatives: 0 }] },
  // The 0014-pattern same-list triggers, food edition.
  { migration: '0022_food-pack-state.sql', description: 'food insert with unknown location aborts',
    sql: "insert into list_food_items (id,user_id,list_id,name,weight_grams,quantity,sort_order,is_packed,packing_location_id,pack_sort_order,created_at,updated_at) values ('lfi-bad-loc','u-seed','list-seed','Bad',1,1,94,0,'nonexistent',50,0,0)",
    expectErrorMatch: /does not belong to this list/ },
  { migration: '0022_food-pack-state.sql', description: "food assignment to another list's location aborts",
    sql: "update list_food_items set packing_location_id='pl-seed' where id='lfi-other-list'",
    expectErrorMatch: /does not belong to this list/ },
  { migration: '0022_food-pack-state.sql', description: 'setup: food assigned to a location',
    sql: "insert into list_food_items (id,user_id,list_id,name,weight_grams,quantity,sort_order,is_packed,packing_location_id,pack_sort_order,created_at,updated_at) values ('lfi-located','u-seed','list-seed','Located',1,1,91,0,'pl-seed-exhausted',0,0,0) returning id",
    expectRows: [{ id: 'lfi-located' }] },
  // The cascade path: deleting a location must return its food to Unassigned
  // as a contiguous block appended after the food maximum (the offset path),
  // not carrying ranks that collide. list-seed's Unassigned food max after
  // the offset backfill is 4 (lfi-canary-b), so lfi-located lands at 5.
  { migration: '0022_food-pack-state.sql', description: 'deleting a location reranks its food into Unassigned',
    sql: "delete from packing_locations where id='pl-seed-exhausted' returning id",
    expectRows: [{ id: 'pl-seed-exhausted' }] },
  { migration: '0022_food-pack-state.sql', description: 'orphaned food appended after the Unassigned maximum',
    sql: "select packing_location_id as loc, pack_sort_order as rank from list_food_items where id='lfi-located'",
    expectRows: [{ loc: null, rank: 5 }] },

  // 0023: food pack-rank enforcement. In this pass the food fixture rows
  // seed AFTER 0022 without declaring pack_sort_order, so they all sit at
  // DEFAULT 0 - exactly the dirty state a degraded old-worker interval would
  // leave - and the repair step must renumber them past the gear maximum
  // before the indexes can even be created. list-seed's Unassigned gear max
  // is 1, its three food rows order by (rank=0 tie, sort_order: 0, 5, 20) ->
  // ranks 2, 3, 4. list-seed-3's single food row is NOT dirty (no duplicate,
  // rank well under the SAFE floor) and keeps its seeded 0.
  { migration: '0023_food-pack-rank-enforcement.sql', description: 'repair renumbers dirty cohorts past the gear maximum',
    sql: "select id, pack_sort_order as rank from list_food_items where id in ('lfi-seed','lfi-canary-b','lfi-canary-c','lfi-other-list') order by id",
    expectRows: [
      { id: 'lfi-canary-b', rank: 4 },
      { id: 'lfi-canary-c', rank: 3 },
      { id: 'lfi-other-list', rank: 0 },
      { id: 'lfi-seed', rank: 2 },
    ] },
  // 0024: the per-meal flag. The point of the DEFAULT is that every row that
  // already existed becomes per-meal, which is what raises the reported pack
  // weight to what is actually being carried. A NULL or 0 here would leave
  // pre-0024 food silently counted as a shared stash - the exact under-report
  // this migration exists to end.
  { migration: '0024_food-per-meal.sql', description: 'every pre-existing food row defaults to per-meal',
    sql: "select count(*) as total, sum(is_per_meal) as per_meal from list_food_items",
    expectRows: [{ total: 4, per_meal: 4 }] },
  { migration: '0024_food-per-meal.sql', description: 'is_per_meal is NOT NULL, so a row cannot go unexplained',
    sql: "insert into list_food_items (id,user_id,list_id,name,weight_grams,quantity,is_per_meal,sort_order,is_packed,is_ready,packing_location_id,pack_sort_order,created_at,updated_at) values ('lfi-null-mode','u-seed','list-seed','NullMode',1,1,null,95,0,0,null,9,0,0)",
    expectErrorMatch: /NOT NULL/ },
  { migration: '0023_food-pack-rank-enforcement.sql', description: 'both food uniqueness indexes exist',
    sql: "select name from sqlite_master where type='index' and name in ('list_food_items_pack_cohort_uq','list_food_items_pack_unassigned_uq') order by name",
    expectRows: [{ name: 'list_food_items_pack_cohort_uq' }, { name: 'list_food_items_pack_unassigned_uq' }] },
  { migration: '0023_food-pack-rank-enforcement.sql', description: 'a duplicate food rank in the unassigned cohort is rejected',
    sql: "insert into list_food_items (id,user_id,list_id,name,weight_grams,quantity,sort_order,is_packed,is_ready,packing_location_id,pack_sort_order,created_at,updated_at) values ('lfi-dup-un','u-seed','list-seed','Dup',1,1,90,0,0,null,2,0,0)",
    expectErrorMatch: /unique/i },
  { migration: '0023_food-pack-rank-enforcement.sql', description: 'setup: food assigned to a location',
    sql: "insert into list_food_items (id,user_id,list_id,name,weight_grams,quantity,sort_order,is_packed,is_ready,packing_location_id,pack_sort_order,created_at,updated_at) values ('lfi-located','u-seed','list-seed','Located',1,1,91,0,0,'pl-seed',0,0,0) returning id",
    expectRows: [{ id: 'lfi-located' }] },
  { migration: '0023_food-pack-rank-enforcement.sql', description: 'a duplicate food rank in a located cohort is rejected',
    sql: "insert into list_food_items (id,user_id,list_id,name,weight_grams,quantity,sort_order,is_packed,is_ready,packing_location_id,pack_sort_order,created_at,updated_at) values ('lfi-dup-loc','u-seed','list-seed','Dup',1,1,92,0,0,'pl-seed',0,0,0)",
    expectErrorMatch: /unique/i },
  // The 0019-pattern range triggers. INSERT permits 0..PACK_RANK_MAX only;
  // UPDATE additionally permits the -200..-1 scratch band (FOOD_ITEM_CAP
  // wide) because parking is an update.
  { migration: '0023_food-pack-rank-enforcement.sql', description: 'a negative food rank cannot be INSERTed',
    sql: "insert into list_food_items (id,user_id,list_id,name,weight_grams,quantity,sort_order,is_packed,is_ready,packing_location_id,pack_sort_order,created_at,updated_at) values ('lfi-neg','u-seed','list-seed','Neg',1,1,93,0,0,null,-1,0,0)",
    expectErrorMatch: /food pack_sort_order out of range/ },
  { migration: '0023_food-pack-rank-enforcement.sql', description: 'an UPDATE below the scratch band aborts',
    sql: "update list_food_items set pack_sort_order = -201 where id='lfi-located'",
    expectErrorMatch: /food pack_sort_order out of range/ },
  { migration: '0023_food-pack-rank-enforcement.sql', description: 'an UPDATE into the scratch band is permitted (parking)',
    sql: "update list_food_items set pack_sort_order = -200 where id='lfi-located' returning id",
    expectRows: [{ id: 'lfi-located' }] },
  { migration: '0023_food-pack-rank-enforcement.sql', description: 'setup: unpark the parked row',
    sql: "update list_food_items set pack_sort_order = 0 where id='lfi-located' returning id",
    expectRows: [{ id: 'lfi-located' }] },
  // The widened dirty predicate's second arm: a unique-but-wedged cohort
  // (max above the SAFE floor) must also have been repaired. Proven by
  // CONTRAPOSITIVE here: after repair + triggers, no food rank may sit above
  // the floor at all - the repair's CASE guarantees it (gear offset only
  // when the whole cohort fits under the floor, dense from 0 otherwise), and
  // the range trigger keeps later writes inside the ceiling.
  { migration: '0023_food-pack-rank-enforcement.sql', description: 'no food rank sits above the SAFE floor after repair',
    sql: "select count(*) as wedged from list_food_items where pack_sort_order > 999999500",
    expectRows: [{ wedged: 0 }] },

  // 0021: the categories cap. u-seed holds exactly one fixture category
  // (cat-seed), so a legitimate insert must still pass, and a recursive
  // fill toward 500 must abort - proving the trigger both exists and fires
  // at the declared boundary rather than merely parsing.
  { migration: '0021_categories-cap.sql', description: 'categories_user_cap trigger exists',
    sql: "select name from sqlite_master where type='trigger' and name='categories_user_cap'",
    expectRows: [{ name: 'categories_user_cap' }] },
  { migration: '0021_categories-cap.sql', description: 'a legitimate category insert still passes',
    sql: "insert into categories (id,user_id,name,sort_order,created_at) values ('cat-chk','u-seed','Chk',1,0) returning id",
    expectRows: [{ id: 'cat-chk' }] },
  // The boundary is proven EXACTLY, not merely "a big insert eventually
  // aborts" (which a 499-threshold trigger would also pass): fill to
  // precisely 500 successfully, count it, then reject one more.
  { migration: '0021_categories-cap.sql', description: 'filling to exactly 500 categories still passes',
    // 2 existing (cat-seed, cat-chk) + 498 = 500.
    sql: "insert into categories (id,user_id,name,sort_order,created_at) with recursive c(x) as (select 1 union all select x+1 from c where x<498) select 'cap-'||x,'u-seed','Cap'||x,x+1,0 from c returning 1 as ok",
    expectRows: Array.from({ length: 498 }, () => ({ ok: 1 })) },
  { migration: '0021_categories-cap.sql', description: 'the fill landed at exactly the cap',
    sql: "select count(*) as n from categories where user_id='u-seed'",
    expectRows: [{ n: 500 }] },
  { migration: '0021_categories-cap.sql', description: 'the 501st category is rejected',
    sql: "insert into categories (id,user_id,name,sort_order,created_at) values ('cap-over','u-seed','Over',999,0)",
    expectErrorMatch: /category cap exceeded/ },

  // 0028: better-auth 1.7's required account.issuer, applied to an EMPTY
  // table (REQUIRE_EMPTY_TABLE: this pass does not seed acct-seed, because
  // the generated `ADD COLUMN ... NOT NULL` is accepted only on an empty
  // table and the migration is meant to refuse anything else). What is
  // proven here is the schema the migration leaves behind: the column has
  // no default, so a writer that omits issuer is refused rather than stored
  // under a sentinel - exactly what the Drizzle snapshot declares.
  { migration: '0028_better_auth_1_7_account_issuer.sql', description: 'an insert that omits issuer is refused',
    sql: "insert into account (id,account_id,provider_id,user_id,updated_at) values ('acct-no-issuer','no-issuer','credential','u-seed',0)",
    expectErrorMatch: /NOT NULL constraint failed: account\.issuer/ },
  { migration: '0028_better_auth_1_7_account_issuer.sql', description: 'setup: a credential row under the local namespace',
    sql: "insert into account (id,issuer,account_id,provider_id,user_id,updated_at) values ('acct-probe','local:credential','acct-probe-subject','credential','u-seed',0) returning id",
    expectRows: [{ id: 'acct-probe' }] },
  { migration: '0028_better_auth_1_7_account_issuer.sql', description: 'a second row under the same identity is refused',
    sql: "insert into account (id,issuer,account_id,provider_id,user_id,updated_at) values ('acct-dup-probe','local:credential','acct-probe-subject','credential','u-seed',0)",
    expectErrorMatch: /UNIQUE constraint failed: account\.issuer, account\.account_id/ },
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

// ---------------------------------------------------------------------------
// DESTRUCTIVE DDL GATE
// ---------------------------------------------------------------------------
// Blocks every rebuild and rename in a NEW migration, with no exception, and
// every REMOVAL that is not declared as a contract step.
//
// WHY THE TWO ARE DIFFERENT, SINCE THIS USED TO TREAT THEM AS ONE
// A rebuild is drizzle-kit's 12-step recipe for a constraint change:
// CREATE __new_x; copy; DROP TABLE x; RENAME. On D1 the
// `PRAGMA foreign_keys=OFF` it wraps that in is a no-op, so the DROP TABLE
// fires every child cascade - that is how 0009 wiped list_items. A native
// `ALTER TABLE ... DROP COLUMN` shares none of that: it rewrites rows in place
// and issues no DROP TABLE, so nothing cascades. This gate banned both for a
// year because the distinction had not been paid for yet.
//
// WHAT STILL CONSTRAINS A REMOVAL, AND IT IS NOT SQLITE
// deploy.yml applies migrations and THEN deploys the Worker, so between those
// steps - indefinitely, if `wrangler deploy` fails - production runs the OLD
// Worker against the NEW schema. A column dropped in the same release that
// removed its reads breaks every request touching it in that window. Hence a
// removal ships one release LATER, declared in CONTRACT_MIGRATIONS.
//
// WHAT THE DECLARATION BUYS, AND WHAT IT DOES NOT
// The gate matches SQL against the declaration statement by statement (never by
// comparing counts - that let `ALTER TABLE d1_migrations DROP COLUMN x` pass as
// a benign column removal), requires every statement in a contract migration to
// BE a removal (so nothing additive can introduce a cascade the parent check
// cannot see), refuses a cascade parent by reading incoming foreign keys off
// the schema rather than trusting a flag, and refuses a column that
// app-schema.ts or a raw sql`` fragment still names.
//
// It CANNOT see what is deployed, so `readsRemovedIn` is a human attestation
// and a green run is not evidence the earlier release shipped. The column scans
// are table-blind and over-block on purpose; read the comment on
// assertColumnUnreferenced before assuming a rejection is a false alarm.
//
// The DROPPED_* constants below are frozen history, not a hatch - see the note
// on them. CONTRACT_MIGRATIONS is the live mechanism.
//
// Additive DDL is untouched: ADD COLUMN, CREATE TABLE, CREATE INDEX and
// CREATE TRIGGER all pass, which is what Phase 8's two releases need.

// Turns SQL into tokens so the classifier never reads a keyword that is really a
// comment, a string, or an identifier that merely spells one.
//
// Quoted identifiers keep their text but are tagged 'ident' rather than 'word'.
// Quoting hides a token's KEYWORD-ness, not its IDENTITY: a table named `drop`
// must not be read as a DROP statement, while `PRAGMA "writable_schema"` and
// `UPDATE "sqlite_schema"` must still be recognized for what they name. An
// earlier version threw the text away and both of those walked straight through.
//
// Fails closed on an unterminated quote or block comment. Unterminated means the
// rest of the file is being swallowed by a construct we cannot see the end of,
// and "scan what is left" would be exactly how a drop slips through.
const tokenizeSql = (sql, label) => {
  const tokens = []
  const bail = (what, at) => {
    throw new Error(
      `${label}: unterminated ${what} starting at offset ${at}. The migration ` +
        'cannot be scanned for destructive DDL, so it is rejected.',
    )
  }

  let i = 0
  while (i < sql.length) {
    const ch = sql[i]

    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i)
      i = nl === -1 ? sql.length : nl + 1
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      if (end === -1) bail('block comment', i)
      i = end + 2
      continue
    }
    // '' inside a string is an escaped quote, not the end of one.
    if (ch === "'") {
      const open = i
      let j = i + 1
      for (;;) {
        const q = sql.indexOf("'", j)
        if (q === -1) bail('string literal', i)
        if (sql[q + 1] === "'") {
          j = q + 2
          continue
        }
        i = q + 1
        break
      }
      // Carries its text for the same reason quoted identifiers do: SQLite
      // accepts a single-quoted STRING where an identifier belongs, so
      // `PRAGMA 'writable_schema'=ON` and `UPDATE 'sqlite_schema'` are real,
      // executable statements. Type stays 'string' so it is never read as a
      // keyword; only the positional name checks look at the value.
      tokens.push({
        type: 'string',
        value: sql.slice(open + 1, i - 1).replaceAll("''", "'").toUpperCase(),
      })
      continue
    }
    const closer = ch === '"' ? '"' : ch === '`' ? '`' : ch === '[' ? ']' : ''
    if (closer) {
      const open = i
      let j = i + 1
      for (;;) {
        const q = sql.indexOf(closer, j)
        if (q === -1) bail('quoted identifier', i)
        // "" and `` double up the same way strings do; [ ] does not.
        if (closer !== ']' && sql[q + 1] === closer) {
          j = q + 2
          continue
        }
        i = q + 1
        break
      }
      const text = sql.slice(open + 1, i - 1)
      tokens.push({
        type: 'ident',
        value: (closer === ']' ? text : text.replaceAll(closer + closer, closer)).toUpperCase(),
      })
      continue
    }
    if (ch === ';') {
      tokens.push({ type: 'semi' })
      i += 1
      continue
    }
    if (/[A-Za-z0-9_$]/.test(ch)) {
      let j = i
      while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j])) j += 1
      tokens.push({ type: 'word', value: sql.slice(i, j).toUpperCase() })
      i = j
      continue
    }
    if (!/\s/.test(ch)) tokens.push({ type: 'punct', value: ch })
    i += 1
  }
  return tokens
}

// Splitting on every `;` also splits trigger bodies, which is harmless: a
// fragment that starts mid-statement begins with a word we do not act on, and a
// fragment that starts with DROP is still caught. SQLite forbids schema DDL
// inside a trigger body, so the split cannot hide one either.
const splitStatements = (tokens) => {
  const statements = []
  let current = []
  for (const token of tokens) {
    if (token.type === 'semi') {
      if (current.length > 0) statements.push(current)
      current = []
      continue
    }
    current.push(token)
  }
  if (current.length > 0) statements.push(current)
  return statements
}

// Keyword position: quoted tokens are excluded, so a table named `drop` is a
// name and not a statement.
const wordAt = (statement, index) =>
  statement[index]?.type === 'word' ? statement[index].value : ''

// Name position: quoted or not, both identify the same object, so
// UPDATE "sqlite_schema" and UPDATE sqlite_schema are the same statement.
const valueAt = (statement, index) => statement[index]?.value ?? ''

// Pragmas that hand out write access to the schema itself.
const SYSTEM_SCHEMA_PRAGMAS = new Set(['WRITABLE_SCHEMA'])

// SQLite's full ON CONFLICT vocabulary, which can sit between the write verb
// and its target.
const CONFLICT_ACTIONS = new Set(['ROLLBACK', 'ABORT', 'REPLACE', 'FAIL', 'IGNORE'])

// Every SQLite form that REMOVES a schema object or renames one out from under
// the deployed Worker. DROP INDEX/TRIGGER/VIEW are in even though they preserve
// rows: a UNIQUE index is a contract the running code relies on.
//
// The drizzle 12-step table rebuild needs no pattern of its own - it contains
// both `DROP TABLE` and `ALTER TABLE ... RENAME TO`, so either convicts it.
const classifyStatement = (statement) => {
  const first = wordAt(statement, 0)

  if (first === 'DROP') {
    const kind = wordAt(statement, 1)
    return `DROP ${kind || '<unknown>'}`
  }

  if (first === 'ALTER' && wordAt(statement, 1) === 'TABLE') {
    // Step over the table name - which may be schema-qualified - and then read
    // the operation, rather than scanning forward for the first operation-shaped
    // keyword. Scanning was wrong: `ALTER TABLE rename ADD COLUMN y` is valid
    // SQLite where the TABLE is called `rename`, and it was being reported as a
    // rename of something.
    let i = 2
    if (statement[i + 1]?.value === '.') i += 2
    // ANY alter of the ledger, including an additive ADD COLUMN. The ledger is
    // excluded from every snapshot below, so a column added to it is a permanent
    // change to wrangler's bookkeeping that nothing here would ever assert on.
    if (valueAt(statement, i) === LEDGER_TABLE.toUpperCase()) {
      return `ALTER TABLE ${LEDGER_TABLE}`
    }
    const op = wordAt(statement, i + 1)
    if (op === 'DROP') return 'ALTER TABLE ... DROP COLUMN'
    if (op === 'RENAME') return 'ALTER TABLE ... RENAME'
    return ''
  }

  // An index or trigger attached to the ledger is another way to reach it - a
  // trigger on d1_migrations fires on wrangler's own bookkeeping writes.
  if (first === 'CREATE') {
    const on = statement.findIndex((t) => t.type === 'word' && t.value === 'ON')
    if (on !== -1) {
      const target =
        statement[on + 2]?.value === '.' ? valueAt(statement, on + 3) : valueAt(statement, on + 1)
      if (target === LEDGER_TABLE.toUpperCase()) {
        return `CREATE ... ON ${LEDGER_TABLE}`
      }
    }
  }

  // Editing sqlite_schema directly is the same operation wearing a disguise, and
  // it is REAL: `PRAGMA writable_schema=ON` plus an UPDATE to sqlite_schema
  // removes a column from a live table without any DDL keyword appearing.
  //
  // Matched on value regardless of token type, because quoting is not a defense:
  // PRAGMA "writable_schema" and UPDATE "sqlite_schema" both work.
  //
  // Position-independent, unlike the DDL forms above. A trigger body's first
  // statement stays glued to its CREATE TRIGGER by the semicolon split, and
  // SQLite permits UPDATE sqlite_schema inside a trigger even though it forbids
  // DROP TABLE - so keying off the leading keyword would miss it entirely.
  //
  // Matched by POSITION, not by mere mention, so that a legitimate additive
  // `CREATE TABLE settings ("writable_schema" integer)` is not rejected for
  // naming a column badly.
  // Both forms below can be schema-qualified - `main.sqlite_schema`,
  // `PRAGMA main.writable_schema` - and skipping that qualifier is how the
  // first version of this let `PRAGMA main.writable_schema = ON` through.
  const nameAfter = (index) => {
    // A qualified name is `schema . object`; take whatever follows the dot.
    if (valueAt(statement, index + 1) === '.' || statement[index + 1]?.value === '.') {
      return valueAt(statement, index + 2)
    }
    return valueAt(statement, index)
  }

  if (first === 'PRAGMA' && SYSTEM_SCHEMA_PRAGMAS.has(nameAfter(1))) {
    return `PRAGMA ${nameAfter(1).toLowerCase()}`
  }

  // A write TARGETING the system schema table. The target is whatever follows
  // the write verb, past any conflict clause: `UPDATE x`, `DELETE FROM x`,
  // `INSERT INTO x`, `INSERT OR IGNORE INTO x`, `UPDATE OR ROLLBACK x`.
  // Scanned anywhere in the statement rather than only at the front, because
  // WITH ... UPDATE puts the verb later and because a trigger body's first
  // statement stays glued to its CREATE TRIGGER when split on semicolons.
  //
  // ...but NOT inside a CREATE TABLE/INDEX/VIEW, where a "verb" can only ever be
  // a column's declared type. SQLite accepts arbitrary type names, so
  // `CREATE TABLE d (x REPLACE sqlite_schema)` is legal and additive, and
  // scanning it reported a write against sqlite_schema. A CREATE TRIGGER is
  // deliberately still scanned - its body really can contain one.
  const createsNonTrigger =
    first === 'CREATE' && ['TABLE', 'INDEX', 'VIEW'].includes(wordAt(statement, 1))
  if (createsNonTrigger) return ''

  for (let i = 0; i < statement.length; i += 1) {
    const verb = valueAt(statement, i)
    if (!['UPDATE', 'DELETE', 'INSERT', 'REPLACE'].includes(verb)) continue
    if (statement[i].type !== 'word') continue
    let target = i + 1
    // `OR ROLLBACK|ABORT|REPLACE|FAIL|IGNORE` - the whole vocabulary, not just
    // REPLACE. Missing IGNORE was a real hole.
    if (valueAt(statement, target) === 'OR' && CONFLICT_ACTIONS.has(valueAt(statement, target + 1))) {
      target += 2
    }
    // INSERT and REPLACE are only writes when INTO follows; DELETE needs FROM.
    // Without this, the word alone is enough, and a column whose declared type
    // happens to be spelled `REPLACE` reads as a statement.
    const next = valueAt(statement, target)
    if (['INSERT', 'REPLACE'].includes(verb) && next !== 'INTO') continue
    if (verb === 'DELETE' && next !== 'FROM') continue
    if (['FROM', 'INTO'].includes(next)) target += 1
    const name = nameAfter(target)
    if (name === 'SQLITE_SCHEMA' || name === 'SQLITE_MASTER') {
      return `${verb} against sqlite_schema`
    }
    // Wrangler's own ledger of which migrations have run. This script explicitly
    // excludes d1_migrations from its snapshots, so nothing below would notice a
    // migration rewriting it - and the consequences are production-level:
    // clearing it makes the next deploy try to reapply the baseline from scratch
    // and fail, while fabricated rows make wrangler skip migrations that never
    // actually ran.
    if (name === LEDGER_TABLE.toUpperCase()) {
      return `${verb} against ${LEDGER_TABLE}`
    }
  }

  return ''
}

const findDestructiveDdl = (sql, label) =>
  splitStatements(tokenizeSql(sql, label))
    .map(classifyStatement)
    .filter(Boolean)

// What one fixture column should hold at the moment the migration under test
// starts, given every declared rewrite of it.
//
// Sorted by migration NUMBER, never by declaration order. Assigning each change
// in turn made the answer depend on the order entries happened to be written in:
// with 0021 declaring A -> B and 0022 declaring B -> C, resolving 0021's pass
// walked A then overwrote it with B. B is precisely the value that makes a
// broken no-op 0021 look correct, since its before and its expected after would
// both be B.
const resolveExpectedValue = (changes, alreadyApplied) => {
  const ordered = [...changes].sort(
    (a, b) => migrationNumber(a.migration) - migrationNumber(b.migration),
  )
  const applied = ordered.filter((change) => alreadyApplied(change.migration))
  // The last rewrite that has already run gives the current value. If none has,
  // the value is whatever the earliest pending one expects to start from.
  return applied.length > 0 ? applied.at(-1).after : ordered[0].before
}

// Every migration that existed when this gate was introduced, pinned by CONTENT.
// Five of them contain destructive DDL (0006, 0009, 0013, 0016, 0019) and all
// five are long since applied to production, so they are grandfathered - the
// gate governs what is added from here on.
//
// Digests, not just names, because a name list only says a file is old; it says
// nothing about whether it still holds what production actually ran. Production
// applied these BY NAME and will never re-run them, so an edit here reaches no
// deployed database while silently changing the schema this script builds to
// test against. Pinning the content is what makes "grandfathered" mean the
// specific text that shipped.
//
// FROZEN. Never add an entry, and never update a digest. Either is
// indistinguishable from disabling the gate for that migration.
const PRE_GATE_MIGRATIONS = new Map([
  ['0000_auth-tables.sql', '66aa24c1650de43e3240f01805560e3401a34c9568958876cb3b5eaa42113f6a'],
  ['0001_rate-limits.sql', 'f127dbf7bdd5ce2438a8ea00e34320713a8a814c2439ef6fb47895ca05c982b9'],
  ['0002_passkeys.sql', '2651a8276a48e0c7268a76bb6c44fdbb6bfdcfc08c8c5396a9de9c64db94d2e8'],
  ['0003_gear.sql', 'c3fdf64490161f54a68110839da7b8ad226d2baec2bee68fec5de76543900d49'],
  ['0004_lists.sql', '40f05e5d9557f09ba05d0581b3d9acb7053285e5c1c5067940862fdbba19ff8b'],
  ['0005_cheerful_shadowcat.sql', '63d158f8f6a762cf037d5864fd7d420d705520ea178366b8247d2a00ed588921'],
  ['0006_passwordless-teardown.sql', 'da4f8e66f7ea8f49ff40510b44becc2c7f451b2d4601013a72cb02dd869be2c9'],
  ['0007_food-items.sql', 'a4bab87af289fdb6bde4ca593024af70aab709f689c349538594d3228b025fb0'],
  ['0008_food-plans.sql', '5603431f9727a85b281d30a40c709848204a1199d80774218fd0aa3ecb1cd3e3'],
  ['0009_food-plan-link.sql', 'c6df6c25f5b9575a83df5c335bcde28ccb48a242d2534e00d394c5865c80c1bb'],
  ['0010_one-plan-per-list.sql', 'ea79cb9d20dff9158fe843471ffacbfb171ab11be0a398f493b4a6425f16e2e6'],
  ['0011_food-pack-state.sql', '5a18960b69ba58d0214bd8a9a61e9ee228d457d8c04aa71cd0c7c29cdf4583bb'],
  ['0012_food-targets.sql', 'ff329b2cca344d97ec98d9d69845d8fbe1ecb9edba0991f7b2099a5763db2ae9'],
  ['0013_gear-weight-real.sql', '1a027499d8e0d2d2bd06c01eeba6b4a8834182096d7d29dffbec49f25a996102'],
  ['0014_packing-locations.sql', 'c79ee9bd1ec2c2a5a2caf4f633045fb816df6fc633aa846c9ab65412a25a2fc5'],
  ['0015_item-backed-containers.sql', 'c4a7c405bb4f1f50fedcc8e953f38792b51f51915140516c3f748b6be790a5fd'],
  ['0016_remove-food-planning.sql', '312cb4afa0e8794415b5328778ce80ded8a71803de9f837c1b6c13329744f326'],
  ['0017_food-estimate.sql', '477a1e8d76710fb3ce9f136a87244917cc6c06914485cd0237d9efbeb47a58dd'],
  ['0018_pack-sort-order.sql', '20fc199d3b3771bd94709ec933e3ca8973ee31520717717a15487d5e69108a2c'],
  ['0019_pack-rank-guard.sql', '8f76d29cd0f8783d39010f845d7f1c4954c12287dad4dc224d3b4a03cca5dee5'],
  ['0020_cascade-rerank.sql', 'bf0aba6cdf3e59b95db8d6896935a93d1f89bdf0c21051015b3e0c75171a7436'],
])

// Wrangler orders migrations by the NUMERIC prefix it parses off the filename,
// not by string comparison, and the two disagree: sorted as text, `00210_x.sql`
// comes before `0022_y.sql`, while wrangler applies 0022 first. Testing in a
// different order than production applies would check a migration against the
// wrong predecessor state, so the number is what counts here too.
const migrationNumber = (name) => {
  const match = /^(\d+)_/.exec(name)
  if (!match) {
    throw new Error(
      `Migration "${name}" does not start with a number followed by an underscore. ` +
        'Wrangler derives apply order from that prefix, so a file without one has ' +
        'no defined position and cannot be checked.',
    )
  }
  return Number(match[1])
}

// The single source of truth for "what is new", used by BOTH halves of this
// script. Derived from the directory, never from a diff, so it is cumulative:
// a migration stays in scope for as long as it exists, rather than only on the
// push that introduced it.
const postBaselineMigrations = () => {
  const names = readdirSync(MIGRATIONS_DIR).filter(
    (name) => name.endsWith('.sql') && !PRE_GATE_MIGRATIONS.has(name),
  )

  // Two migrations sharing a number have no defined order relative to each
  // other, so neither this script nor production can say which runs first.
  //
  // Seeded with the BASELINE numbers, not just the new ones. A fresh
  // `0020_other.sql` beside the baseline's `0020_cascade-rerank.sql` is the same
  // ambiguity, and checking only post-baseline files against each other would
  // wave it through - this harness always applies the whole baseline first, so
  // it would never notice what a fresh wrangler run cannot order.
  const seen = new Map(
    [...PRE_GATE_MIGRATIONS.keys()].map((name) => [migrationNumber(name), name]),
  )
  for (const name of names) {
    const number = migrationNumber(name)
    if (seen.has(number)) {
      throw new Error(
        `Migrations "${seen.get(number)}" and "${name}" share the number ${number}. ` +
          'Apply order between them is undefined. Renumber one.',
      )
    }
    seen.set(number, name)
  }

  return names.sort((a, b) => migrationNumber(a) - migrationNumber(b))
}

// Removes // and /* */ comments while respecting string literals, so a `//` or
// `/*` INSIDE a JSON string is left alone. Escapes are tracked, so a string
// ending in a backslash-escaped quote does not look terminated early.
const stripJsonComments = (text) => {
  let out = ''
  let i = 0
  let inString = false
  while (i < text.length) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += text[i + 1] ?? ''
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i += 1
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i += 1
      continue
    }
    // Trailing commas: wrangler's JSONC parser accepts them, strict JSON.parse
    // does not. Dropped HERE, inside the string-aware scan, rather than by a
    // regex over the whole document - that regex rewrote the CONTENTS of valid
    // strings, turning {"note":"literal ,} text"} into {"note":"literal } text"}.
    // A comma emitted inside a string is always followed by more string and then
    // a closing quote, so a comma sitting immediately before a closer out here
    // is always a real trailing comma.
    if (ch === '}' || ch === ']') {
      out = out.replace(/,(\s*)$/, '$1')
    }
    if (ch === '/' && text[i + 1] === '/') {
      // Ends at CR or LF - a lone CR is a line ending too, and treating it as
      // ordinary text would swallow the rest of the file as comment.
      let end = i
      while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end += 1
      i = end
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end === -1) throw new Error('unterminated block comment')
      i = end + 2
      continue
    }
    out += ch
    i += 1
  }
  return out
}

// This script enumerates `migrations/` itself, but `wrangler d1 migrations
// apply` reads the directory from wrangler.jsonc. If those ever diverge, this
// check would scan an empty or stale directory, report nothing to do, and let
// deploy apply SQL from somewhere it never looked at. Cheap to pin, so pin it.
//
// An ABSENT migrations_dir is fine - wrangler's default is exactly this
// directory. A present one has to agree.
// Every migration in drizzle's journal must have its snapshot on disk, and the
// journal must cover every .sql file in the directory.
//
// WHY THIS EXISTS
// drizzle-kit decides what SQL to emit by diffing server/db/schema.ts against
// the NEWEST snapshot in migrations/meta. A missing snapshot does not fail
// anything at apply time - wrangler never reads meta/ - so the chain can rot in
// total silence, and the damage only appears the next time somebody runs
// `generate`.
//
// That is not hypothetical. 0018 and 0021-0024 were authored by hand and their
// snapshots were never regenerated, so drizzle's idea of the schema froze at
// 0020. By 0024, `generate` emitted a migration re-adding five columns and
// three tables that already existed - which D1 rejects as `duplicate column
// name`. Nothing went red, because nothing looked. Migration 0025 repaired the
// chain; this check is what stops it happening again.
//
// It deliberately checks the JOURNAL against the DIRECTORY in both directions.
// A .sql file with no journal entry is the other half of the same failure: the
// next `generate` would hand out a number that is already taken.
// First migration held to the snapshot rule. 0018 and 0021-0024 shipped
// without one and no honest repair exists: a snapshot describes the schema AS
// OF its migration, and reconstructing intermediate states after the fact
// would fabricate a record of something nobody observed. They are already in
// production and cannot change.
//
// Enforcement starts at 0025 because that is the migration that rebuilt
// drizzle's basis. Missing INTERMEDIATE snapshots are harmless on their own -
// drizzle only ever diffs against the effective latest one - so the floor
// costs nothing. What broke was the latest basis being four migrations stale.
const SNAPSHOT_ENFORCEMENT_FROM = 25

// The snapshot file a journal entry owns.
//
// Derived from the entry's own TAG, not from `String(idx).padStart(4, '0')`.
// Those agree under the default index prefix and diverge under
// `--prefix timestamp` / `--prefix unix`, where the padded idx would name a
// file that does not exist and this check would reject a legitimate migration.
const snapshotNameForEntry = (entry) => `${String(entry.tag).split('_')[0]}_snapshot.json`

// The drizzle snapshot chain: every migration accounted for in BOTH
// directions, no orphans, and the basis drizzle actually diffs against being
// the current one.
//
// WHY THIS EXISTS
// drizzle-kit decides what SQL to emit by diffing server/db/schema.ts against
// the newest snapshot in migrations/meta. Nothing at apply time reads meta/ -
// wrangler does not know it exists - so the chain can rot in total silence,
// and the damage only appears the next time somebody runs `generate`.
//
// That is not hypothetical. 0018 and 0021-0024 were hand-authored without
// snapshots, so drizzle's view froze at 0020. By 0024 `generate` emitted a
// migration re-adding five columns and three tables that already existed,
// which D1 rejects as `duplicate column name`. Nothing went red, because
// nothing looked. 0025 rebuilt the basis; this keeps it rebuilt.
//
// This function proves BOOKKEEPING ONLY. It cannot speak for a snapshot's
// CONTENTS: `generate --custom` copies its predecessor forward, so a
// schema-changing migration written by hand can ship a stale snapshot and
// satisfy every rule here. verifySnapshotMatchesSchema() covers that, and the
// two are only sufficient together.
const verifySnapshotChainIntact = () => {
  const metaDir = join(MIGRATIONS_DIR, 'meta')
  const journalPath = join(metaDir, '_journal.json')
  let journal
  try {
    journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `${journalPath} could not be read or parsed, so the drizzle snapshot ` +
        `chain cannot be verified: ${error.message}`,
    )
  }

  // Structure, before anything indexes into it. Parsed-but-wrong JSON would
  // otherwise surface as a raw TypeError from inside a loop below, which reads
  // like a bug in this script rather than a broken journal.
  if (journal === null || typeof journal !== 'object' || Array.isArray(journal)) {
    throw new Error(`${journalPath} is not a JSON object.`)
  }
  const entries = journal.entries
  if (!Array.isArray(entries)) {
    throw new Error(`${journalPath} has no "entries" array.`)
  }
  entries.forEach((entry, i) => {
    if (entry === null || typeof entry !== 'object') {
      throw new Error(`${journalPath} entry ${i} is not an object.`)
    }
    if (!Number.isInteger(entry.idx)) {
      throw new Error(`${journalPath} entry ${i} has no integer "idx".`)
    }
    if (typeof entry.tag !== 'string' || entry.tag.length === 0) {
      throw new Error(`${journalPath} entry ${entry.idx} has no "tag".`)
    }
  })

  // Journal INVARIANTS, not just field types. drizzle derives the next index
  // from the LAST entry in the array - not from the maximum idx - so an
  // out-of-order or duplicated journal makes the next generate reuse a number
  // and overwrite an existing snapshot. Type checks alone let all of that
  // through.
  const seenIdx = new Set()
  const seenTag = new Set()
  const seenPrefix = new Map()
  let previousIdx = null
  for (const entry of entries) {
    if (seenIdx.has(entry.idx)) {
      throw new Error(`${journalPath} has two entries with idx ${entry.idx}.`)
    }
    seenIdx.add(entry.idx)
    if (seenTag.has(entry.tag)) {
      throw new Error(`${journalPath} has two entries tagged ${entry.tag}.`)
    }
    seenTag.add(entry.tag)
    if (previousIdx !== null && entry.idx <= previousIdx) {
      throw new Error(
        `${journalPath} is out of order: idx ${entry.idx} follows ${previousIdx}. ` +
          'drizzle takes the LAST entry to decide the next number, so the next ' +
          'generate would reuse one and overwrite its snapshot.',
      )
    }
    previousIdx = entry.idx
    const prefix = snapshotNameForEntry(entry)
    if (seenPrefix.has(prefix)) {
      throw new Error(
        `${journalPath}: ${seenPrefix.get(prefix)} and ${entry.tag} both map ` +
          `to ${prefix}, so one snapshot would overwrite the other.`,
      )
    }
    seenPrefix.set(prefix, entry.tag)
  }

  const failures = []
  // EVERY file drizzle would consider, which is not the same as every file
  // named *_snapshot.json: drizzle sorts all of meta/ except names starting
  // with '_' and takes the last. So a stray `9999.json` becomes its basis
  // while a *_snapshot.json filter looks straight past it.
  const snapshots = new Set(
    readdirSync(metaDir).filter((name) => !name.startsWith('_')),
  )
  const sqlFiles = new Set(
    readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')),
  )

  const expectedSnapshots = new Set()
  for (const entry of entries) {
    const expected = snapshotNameForEntry(entry)
    expectedSnapshots.add(expected)

    if (entry.idx >= SNAPSHOT_ENFORCEMENT_FROM && !snapshots.has(expected)) {
      failures.push(
        `journal entry ${entry.idx} (${entry.tag}) has no ${expected}. Use ` +
          '`drizzle-kit generate` for a schema change and `generate --custom` ' +
          'for a data-only one; both write the snapshot for you.',
      )
    }

    // journal -> .sql. Without this a journal entry and snapshot can ship with
    // no migration file: wrangler applies FILES, so the change never reaches a
    // database, while drizzle's basis says it did - and the next generate
    // therefore never emits it again.
    if (!sqlFiles.has(`${entry.tag}.sql`)) {
      failures.push(
        `journal entry ${entry.idx} names ${entry.tag}.sql, which does not ` +
          'exist. wrangler applies files, not journal entries, so this change ' +
          "would never reach a database while drizzle's basis assumes it did.",
      )
    }
  }

  // .sql -> journal. The other direction: wrangler applies it either way, but
  // drizzle does not know it exists and will hand its number out again.
  const tagged = new Set(entries.map((entry) => `${entry.tag}.sql`))
  for (const name of sqlFiles) {
    if (!tagged.has(name)) {
      failures.push(
        `${name} is not registered in meta/_journal.json. wrangler applies it ` +
          'either way, but drizzle does not know it exists and will reuse its ' +
          'number.',
      )
    }
  }

  // Orphan snapshots, which matter more than they look: drizzle picks its
  // basis by sorting snapshot FILENAMES and taking the last, with no reference
  // to the journal at all. A stray 9999_snapshot.json silently becomes the
  // schema every future generate diffs against.
  for (const name of snapshots) {
    if (!expectedSnapshots.has(name)) {
      failures.push(
        `${name} has no journal entry. drizzle selects its basis by sorting ` +
          'snapshot filenames, so an orphan can silently become the schema it ' +
          'diffs against.',
      )
    }
  }

  // The basis drizzle will actually use must belong to the newest migration.
  // Compared by sorted FILENAME because that is what drizzle does - not by max
  // idx, which is what a reader assumes and is not the same thing under a
  // non-default prefix.
  const newestEntry = entries.reduce(
    (max, entry) => (max === null || entry.idx > max.idx ? entry : max),
    null,
  )
  const newestSnapshot = [...snapshots].sort().at(-1)
  if (newestEntry && newestSnapshot) {
    const expected = snapshotNameForEntry(newestEntry)
    if (newestSnapshot !== expected) {
      failures.push(
        `drizzle's basis would be ${newestSnapshot}, but the newest migration ` +
          `is ${newestEntry.tag}, whose snapshot is ${expected}. Every change ` +
          'between them would be re-emitted by the next generate.',
      )
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `The drizzle snapshot chain is broken:\n  ${failures.join('\n  ')}`,
    )
  }
  console.log(
    `OK: snapshot chain intact - ${entries.length} journal entries, each with ` +
      'its .sql, no orphan snapshots, and the newest snapshot is the basis.',
  )
}

// The snapshot's CONTENTS, which the bookkeeping check above cannot speak for.
//
// The hole it closes, concretely: `generate --custom` copies the previous
// snapshot forward. That is correct for a data-only migration and wrong for
// anything that changes the schema - so an author can run `--custom`,
// hand-write an ALTER TABLE into it, and ship a snapshot that omits the
// column. Every filename rule above still passes, and the next regular
// `generate` re-emits the same ALTER against a database that already has it.
// That is the 0021-0024 failure exactly, and filenames cannot see it.
//
// drizzle's own generator is the oracle: if the newest snapshot describes the
// schema, generating produces nothing. Run against a COPY of meta/ in a temp
// directory, so noticing a stale basis cannot itself write a migration into
// the real tree as a side effect.
// drizzle-kit's success line. Matched as a substring because the real output
// carries a trailing emoji.
const NO_CHANGES_MARKER = 'No schema changes, nothing to migrate'

const verifySnapshotMatchesSchema = () => {
  // Relative, and inside the repo, because drizzle-kit resolves --out against
  // the cwd by prefixing './': an absolute /tmp path becomes './/tmp/...' and
  // the run dies on ENOENT. mkdtemp in the system temp dir is the obvious
  // choice here and does not work.
  const probeDir = `.snapshot-probe-${process.pid}`
  try {
    rmSync(probeDir, { recursive: true, force: true })
    cpSync(join(MIGRATIONS_DIR, 'meta'), join(probeDir, 'meta'), { recursive: true })
    // --dialect and --schema explicitly: passing --out on the CLI stops
    // drizzle-kit reading them from drizzle.config.ts, and it exits with
    // "Please provide required params" rather than falling back.
    //
    // Both streams captured, and NOT through run(): drizzle-kit catches several
    // generation failures - a malformed snapshot, a rename prompt it cannot
    // show on a non-TTY - prints them, and exits 0. Trusting the exit code
    // means those land here as "no .sql was emitted", which this function would
    // report as success. So the test is the presence of the SUCCESS MARKER,
    // never the absence of failure.
    //
    // spawnSync, not execFileSync: execFileSync RETURNS stdout only. Piping
    // stderr does not fold it into that return value - it is reachable only
    // through the thrown error, and only when the child exits nonzero. Since
    // the whole point here is the case where drizzle prints an error and exits
    // ZERO, execFileSync would leave the diagnostic below empty exactly when it
    // is needed.
    const probe = spawnSync(
      'npx',
      [
        'drizzle-kit',
        'generate',
        '--dialect',
        'sqlite',
        '--schema',
        './server/db/schema.ts',
        '--out',
        probeDir,
        '--name',
        'probe',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    if (probe.error) {
      throw new Error(
        `drizzle-kit generate could not be run, so the snapshot could not be ` +
          `checked against server/db/schema.ts: ${probe.error.message}`,
      )
    }
    const output = [probe.stdout, probe.stderr].filter(Boolean).join('\n')
    if (probe.status !== 0) {
      throw new Error(
        `drizzle-kit generate failed, so the snapshot could not be checked ` +
          `against server/db/schema.ts:\n${output.trim() || `exit ${probe.status}`}`,
      )
    }

    const emitted = readdirSync(probeDir).filter((name) => name.endsWith('.sql'))
    if (emitted.length === 0 && !output.includes(NO_CHANGES_MARKER)) {
      throw new Error(
        'drizzle-kit generate emitted no migration AND did not report ' +
          `"${NO_CHANGES_MARKER}", so it did not actually compare anything. ` +
          'It exits 0 after catching some failures, so silence here is not ' +
          `proof the snapshot is current. Its output was:\n\n${output.trim()}`,
      )
    }
    if (emitted.length > 0) {
      const body = readFileSync(join(probeDir, emitted[0]), 'utf8').trim()
      throw new Error(
        'The newest drizzle snapshot does not describe server/db/schema.ts, so ' +
          '`drizzle-kit generate` would emit SQL for changes that are already ' +
          'in the migrations:\n\n' +
          body
            .split('\n')
            .map((line) => `    ${line}`)
            .join('\n') +
          '\n\nThat is the 0021-0024 rot in miniature: a migration whose ' +
          'snapshot was copied forward by `generate --custom` rather than ' +
          'produced by `generate`. Regenerate the snapshot for the migration ' +
          'that changed the schema.',
      )
    }
    console.log('OK: newest snapshot matches server/db/schema.ts.')
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
}

// wrangler.jsonc, parsed. Shared by the pin check below and by the per-pass
// config generator, so both read the same file the same way and a rename in
// one cannot drift from the other.
const readTrackedConfig = () => {
  let config
  try {
    config = readFileSync('wrangler.jsonc', 'utf8')
  } catch {
    throw new Error('wrangler.jsonc could not be read, so the migrations directory cannot be verified.')
  }
  // Parsed structurally, not pattern-matched. Both shortcuts fail OPEN, which is
  // the worst direction for a check like this:
  //   - stripping comments without tracking strings turns
  //     {"note":"/*","migrations_dir":"elsewhere","tail":"*/"} into {"note":""},
  //     hiding the setting completely;
  //   - a regex for "migrations_dir" misses {"migrations_dir":"elsewhere"},
  //     which wrangler's own parser resolves to the real key.
  // Stripping comments string-aware and then handing the result to JSON.parse
  // closes both: JSON.parse resolves escapes, and reading the parsed object
  // finds the key however it was spelled.
  //
  // Scoped to the ONE d1_databases entry this script migrates. A recursive
  // hunt for every `migrations_dir` anywhere in the file would fail CI over a
  // second, unrelated database legitimately using its own directory.
  let parsed
  try {
    parsed = JSON.parse(stripJsonComments(config))
  } catch (error) {
    throw new Error(`wrangler.jsonc could not be parsed, so the migrations directory cannot be verified: ${error.message}`)
  }

  // Matched on database_name OR binding, because `wrangler d1 migrations apply
  // <name>` accepts either and takes the FIRST match. Selecting only on
  // database_name could validate one entry's directory while wrangler applied a
  // different entry's - an earlier binding: "grampacker" would win there and
  // lose here.
  return parsed
}

// The ONE d1_databases entry this script migrates. Matched on database_name OR
// binding, because `wrangler d1 migrations apply <name>` accepts either and
// takes the FIRST match. Selecting only on database_name could validate one
// entry's directory while wrangler applied a different entry's - an earlier
// binding: "grampacker" would win there and lose here.
const selectOurD1Entry = (parsed) => {
  const databases = Array.isArray(parsed?.d1_databases) ? parsed.d1_databases : []
  const ours = databases.filter(
    (entry) => entry?.database_name === DB || entry?.binding === DB,
  )
  if (ours.length !== 1) {
    throw new Error(
      `wrangler.jsonc has ${ours.length} d1_databases entries matching "${DB}" ` +
        '(by database_name or binding); expected exactly one, so the migrations ' +
        'directory cannot be verified.',
    )
  }
  return ours[0]
}

// ---------------------------------------------------------------------------
// The per-pass wrangler config and staged migrations directory.
//
// This script used to rewind the database by DELETING held-back migration files
// out of the tracked `migrations/` tree and writing them back afterwards, with a
// backup directory and signal handlers to survive a crash mid-rewind. Anything
// else reading that directory during a run saw a truncated set: the API suite
// migrates from it (vitest.workers.config.ts), and a concurrent run produced 114
// failures. Wrangler resolves `migrations_dir` relative to the config file it is
// given, so each pass now stages exactly the files it should see beside a
// generated config and points wrangler at that instead. The tracked tree is only
// ever read.

// Backslashes FIRST, then posix.normalize - the order wrangler uses, and the
// order that matters: on POSIX, path.normalize() does not treat `\` as a
// separator, so normalizing first leaves `migrations\nested\*.sql` as ONE
// component and every later comparison is made against the wrong shape.
const normalizeRelPath = (value) => {
  const normalized = posix.normalize(String(value).replace(/\\/g, '/')).replace(/\/+$/, '')
  return normalized === '.' ? '' : normalized.replace(/^\.\//, '')
}

// The part of `path` below `dir`, or null when it is not below it. Uses
// posix.relative rather than string surgery so `.`, doubled separators and a
// similarly-named sibling all answer correctly: `migrations-old` starts with
// `migrations` and is NOT inside it.
const pathUnder = (dir, path) => {
  const rel = posix.relative(normalizeRelPath(dir), normalizeRelPath(path))
  if (rel === '' || rel.startsWith('../') || posix.isAbsolute(rel)) return null
  return rel
}

// The tracked entry, with ONLY its migration paths pointed at the staged
// directory. Copied wholesale rather than rebuilt field by field: a key this
// function does not know about (preview_database_id today, something else after
// the next wrangler release) must reach the generated config unchanged, or the
// harness would apply migrations under a configuration production does not have.
const rebaseD1Entry = (entry, stagedDir) => {
  const rebased = { ...entry, migrations_dir: normalizeRelPath(stagedDir) }
  const pattern = entry.migrations_pattern
  if (pattern !== undefined) {
    // Wrangler refuses a pattern with no migrations_dir outright. Substituting
    // the default here would accept a config wrangler rejects.
    if (entry.migrations_dir === undefined) {
      throw new Error(
        `wrangler.jsonc sets migrations_pattern "${pattern}" without a ` +
          'migrations_dir. Wrangler rejects that combination; fix the config ' +
          'rather than the harness.',
      )
    }
    const tail = pathUnder(entry.migrations_dir, pattern)
    if (tail === null) {
      throw new Error(
        `wrangler.jsonc sets migrations_pattern "${pattern}", which is not ` +
          `inside migrations_dir "${entry.migrations_dir}". Wrangler rejects that ` +
          'combination too (it requires the pattern to start with migrations_dir); ' +
          'fix the config rather than the harness.',
      )
    }
    rebased.migrations_pattern = `${normalizeRelPath(stagedDir)}/${tail}`
  }
  return rebased
}

// The ledger table wrangler will actually use. Defaulted, not assumed: an
// assertion hard-coded to `d1_migrations` would read an empty table and pass
// while wrangler wrote somewhere else entirely.
// The tracked migration tree, hashed by CONTENTS, recursively.
//
// Names and sizes are not enough: a migration edited in place to something the
// same length is exactly the mutation this exists to catch. `meta/` is included
// because the snapshot chain lives there and a stray write would silently
// rebase what the next `drizzle-kit generate` diffs against.
const trackedTreeDigest = (dir = MIGRATIONS_DIR) => {
  const hash = createHash('sha256')
  const walk = (current, prefix) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
    for (const entry of entries) {
      const path = join(current, entry.name)
      const label = `${prefix}${entry.name}`
      if (entry.isDirectory()) {
        hash.update(`d ${label}\n`)
        walk(path, `${label}/`)
      } else {
        hash.update(`f ${label} `)
        hash.update(readFileSync(path))
        hash.update('\n')
      }
    }
  }
  walk(dir, '')
  return hash.digest('hex')
}

const migrationsTableName = () =>
  selectOurD1Entry(readTrackedConfig()).migrations_table ?? LEDGER_TABLE

// Copies the named tracked migrations into the pass's own directory. Never the
// other way round: nothing here writes to MIGRATIONS_DIR.
const stageMigrationsDir = (dir, names) => {
  const stagedDir = join(dir, 'migrations')
  rmSync(stagedDir, { recursive: true, force: true })
  mkdirSync(stagedDir, { recursive: true })
  for (const name of names) {
    copyFileSync(join(MIGRATIONS_DIR, name), join(stagedDir, name))
  }
  return stagedDir
}

const writeWranglerConfig = (dir, stagedDir) => {
  const tracked = readTrackedConfig()
  const config = {
    name: tracked.name,
    compatibility_date: tracked.compatibility_date,
    compatibility_flags: tracked.compatibility_flags,
    // migrations_dir is resolved relative to the config file, so the staged
    // directory is named relative to it rather than absolutely.
    d1_databases: [rebaseD1Entry(selectOurD1Entry(tracked), relative(dir, stagedDir))],
  }
  const path = join(dir, 'wrangler.json')
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
  return path
}

const verifyMigrationsDirIsPinned = () => {
  // Absent means wrangler's default, which is this directory.
  const configured = selectOurD1Entry(readTrackedConfig()).migrations_dir
  if (configured !== undefined && configured !== MIGRATIONS_DIR) {
    throw new Error(
      `wrangler.jsonc sets migrations_dir to "${configured}" for "${DB}", ` +
        `but this check only ever scans "${MIGRATIONS_DIR}". Deploy would apply ` +
        'migrations from a directory nothing verified. Point them at the same place.',
    )
  }
}

// The baseline is the schema every other check builds on, so it has to still be
// the baseline. Verifies presence AND content on every run.
const verifyBaselineIntact = () => {
  const problems = []
  for (const [name, digest] of PRE_GATE_MIGRATIONS) {
    let actual
    try {
      actual = createHash('sha256')
        .update(readFileSync(join(MIGRATIONS_DIR, name)))
        .digest('hex')
    } catch {
      problems.push(`${name}: missing (production has applied it; it cannot be deleted)`)
      continue
    }
    if (actual !== digest) {
      problems.push(`${name}: content changed (expected ${digest.slice(0, 12)}, got ${actual.slice(0, 12)})`)
    }
  }
  if (problems.length > 0) {
    throw new Error(
      'The frozen migration baseline has been altered:\n' +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n\nProduction applied these by name and will never re-run them, so ' +
        'editing or deleting one changes nothing there while silently changing ' +
        'the schema this script tests against. Restore them and add a NEW ' +
        'migration instead.',
    )
  }
}

// Scans by DIRECTORY CONTENTS, not by git diff, and that is the whole point.
//
// A diff-based gate washes through: commit A adds destructive migration 0021 and
// its CI goes red, so nothing deploys. Commit B adds no migration at all, so the
// diff from A to B is empty and B's CI is green - and B's deploy runs
// `wrangler d1 migrations apply`, which applies every PENDING migration,
// including 0021. The red run never blocked anything.
//
// Anchoring to a frozen baseline instead means 0021 is re-scanned on every run
// for as long as it exists, so it cannot ride in behind a later commit.
// Objects a migration is allowed to REMOVE, and the release that earned it.
//
// The blanket ban this replaces was correct about rebuilds and wrong about
// everything else, because when it was written the two had not been told apart.
// `ALTER TABLE ... DROP COLUMN` is not the 12-step rebuild that wiped
// list_items in 0009: it rewrites rows in place, never issues DROP TABLE, and
// so fires no cascade. Verified against sqlite3 3.46.1 with foreign_keys=ON
// inside a transaction, which is D1's setup.
//
// What survives is OUR constraint, not SQLite's: deploy.yml applies migrations
// and THEN swaps the Worker, so a column dropped in the same release that
// removed its reads 500s every request touching it until the deploy lands -
// indefinitely if the deploy fails. Hence: one release later, never the same.
//
// WHAT THIS GATE PROVES, AND WHAT IT MERELY RECORDS. It proves the migration
// removes exactly the objects declared here and nothing else, and for a column
// it proves the name is gone from server/db/app-schema.ts. It CANNOT prove the
// previous release reached production - CI has no view of what is deployed.
// `readsRemovedIn` is a human attestation of that, and a green check is not
// evidence for it. Say so out loud rather than letting the green imply it.
const CONTRACT_MIGRATIONS = new Map([
  [
    '0027_contract_drop_retired.sql',
    {
      // Attested, NOT proven. CI cannot see production. This names the release
      // that removed the last read of each object and shipped it; a green run
      // says the migration matches this declaration, not that the release
      // deployed.
      readsRemovedIn:
        '#213 (needed, deployed 2026-08-19) + #214 backfill; #110/2026-07-21 ' +
        '(group_worn); 2026-08-11 (ready_checks_enabled); 0023 (_food_rank_repair)',
      objects: [
        // Must come out before the column it references, or SQLite refuses.
        { kind: 'trigger', name: 'list_food_item_slots_needed_only' },
        { kind: 'column', table: 'list_food_slots', name: 'needed' },
        { kind: 'column', table: 'lists', name: 'group_worn' },
        { kind: 'column', table: 'lists', name: 'ready_checks_enabled' },
        // Nothing has a foreign key pointing at this, so its DROP TABLE fires
        // no cascade. That is not taken on trust: the replay reads incoming
        // ON DELETE CASCADE references off the live schema immediately before
        // the drop and refuses a cascade parent outright.
        { kind: 'table', name: '_food_rank_repair' },
      ],
    },
  ],
])

// The target an object-removing statement names, for matching against a
// declaration. Deliberately a SEPARATE function from classifyStatement rather
// than a widening of it: that one is covered by DDL_GATE_CASES and is the only
// thing standing between this repo and a repeat of 0009, so it is left exactly
// as it is.
//
// Returns null for anything that is not a removal, including the forms that are
// never declarable (renames, ledger writes, sqlite_schema edits) - those are
// caught by the classifier and must stay caught.
const describeRemoval = (statement) => {
  const first = wordAt(statement, 0)
  const named = (index) =>
    statement[index + 1]?.value === '.'
      ? String(valueAt(statement, index + 2) || '').toLowerCase()
      : String(valueAt(statement, index) || '').toLowerCase()

  if (first === 'DROP') {
    const kind = wordAt(statement, 1)
    if (!['TABLE', 'TRIGGER', 'INDEX'].includes(kind)) return null
    // Step over an optional IF EXISTS before reading the name.
    let i = 2
    if (wordAt(statement, 2) === 'IF' && wordAt(statement, 3) === 'EXISTS') i = 4
    const name = named(i)
    // The ledger table itself is never declarable. Scoped to DROP TABLE on
    // purpose: an INDEX or TRIGGER may legitimately be NAMED `d1_migrations`
    // while belonging to an ordinary table, and SQLite allows it. Only the
    // table target is the ledger.
    if (kind === 'TABLE' && name === LEDGER_TABLE) return null
    return { kind: kind.toLowerCase(), name }
  }

  if (first === 'ALTER' && wordAt(statement, 1) === 'TABLE') {
    let i = 2
    if (statement[i + 1]?.value === '.') i += 2
    const table = String(valueAt(statement, i) || '').toLowerCase()
    // ANY alter of wrangler's ledger, INCLUDING a column drop. classifyStatement
    // calls this a forbidden ledger alteration; without this line describeRemoval
    // called the identical statement a benign column removal, and the gate's
    // count comparison saw one of each and let a declaration authorize writing
    // to wrangler's own bookkeeping. That is the bug this early return closes,
    // and the statement-by-statement matching below is what stops the class of
    // it recurring.
    if (table === LEDGER_TABLE) return null
    if (wordAt(statement, i + 1) !== 'DROP') return null
    // `DROP COLUMN x` and the equivalent `DROP x`.
    const j = wordAt(statement, i + 2) === 'COLUMN' ? i + 3 : i + 2
    return { kind: 'column', table, name: String(valueAt(statement, j) || '').toLowerCase() }
  }

  return null
}

// A dropped COLUMN must be gone from the Drizzle schema, which in this repo is
// the only place the app can reach a column from: route handlers never touch
// the DB, so every read goes through a repo, and every repo goes through here.
//
// This is a real check with a real limit, and the limit is the deploy window
// rather than the grep: it proves the code being deployed NOW has no reference,
// not that the code currently RUNNING has none. That is what readsRemovedIn is
// for.
const assertColumnUnreferenced = (table, column, migration) => {
  // Raw SQL first, because it is the case a schema search cannot see. The repos
  // build most statements through drizzle, but sql`` fragments and sql.raw()
  // exist and name columns as text.
  //
  // WHAT THIS DELIBERATELY GETS WRONG, since a check nobody understands is a
  // check nobody trusts:
  //   - it is TABLE-BLIND. A fragment naming `name` blocks dropping ANY column
  //     called `name`, on any table. Knowing which table a raw fragment targets
  //     means parsing SQL out of a template with interpolations in it, and the
  //     failure mode of getting THAT wrong is permitting a drop that breaks
  //     production. Over-blocking is the safe direction: it is loud, it happens
  //     at author time, and the author can look at the fragment and see it is
  //     unrelated.
  //   - a nested tagged template can truncate the match, so this is a floor on
  //     what is caught rather than a ceiling.
  // It is a second line behind the app-schema check below, not a substitute for
  // reading the diff.
  const rawSqlHits = []
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, item.name)
      if (item.isDirectory()) {
        if (item.name === 'node_modules') continue
        walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(item.name)) continue
      if (item.name.endsWith('.test.ts') || item.name.endsWith('.test.tsx')) continue
      const text = readFileSync(full, 'utf8')
      // Only inside a sql`` template or a sql.raw() argument. A bare mention
      // elsewhere is a comment or a camelCase property, and flagging those
      // would make this so noisy nobody would keep it.
      for (const fragment of text.match(/sql`[^`]*`|sql\.raw\([^)]*\)/g) || []) {
        // Case-INSENSITIVE: SQL keywords and identifiers are, so `SELECT NEEDED`
        // is the same column as `needed` and a case-sensitive scan walked
        // straight past it.
        if (new RegExp(`\\b${column}\\b`, 'i').test(fragment)) rawSqlHits.push(full)
      }
    }
  }
  walk('server')
  if (rawSqlHits.length > 0) {
    throw new Error(
      `${migration} drops ${table}.${column}, but raw SQL still names that ` +
        `column in: ${[...new Set(rawSqlHits)].join(', ')}. Drizzle-built ` +
        'queries are covered by the schema check below; a raw fragment is not, ' +
        'and it fails at runtime rather than at build time.',
    )
  }

  const schema = readFileSync('server/db/app-schema.ts', 'utf8')
  // Drizzle names the SQL column in a string literal - `integer('needed')` -
  // so the quoted spelling is what a surviving reference looks like. The
  // camelCase property cannot be searched for reliably; it is the SQL name
  // that this migration removes.
  //
  // Table-blind for the same reason as the raw-SQL scan above: this matches the
  // column name anywhere in the file, so dropping `lists.name` would trip on
  // `gear_items.name` too. Over-blocking, loud, at author time.
  const quoted = new RegExp(`['"\`]${column}['"\`]`)
  if (quoted.test(schema)) {
    throw new Error(
      `${migration} drops ${table}.${column}, but server/db/app-schema.ts still ` +
        'names that column. Remove it from the schema in the same migration, or ' +
        'drizzle will keep selecting a column that no longer exists.',
    )
  }
}

const gateNewMigrations = () => {
  const files = postBaselineMigrations()

  const destructive = files
    .map((name) => {
      const path = join(MIGRATIONS_DIR, name)
      return { path, found: findDestructiveDdl(readFileSync(path, 'utf8'), path) }
    })
    .filter((entry) => entry.found.length > 0)

  // Every file that is EITHER destructive OR declared. Iterating only the
  // destructive ones had a hole: a declared migration containing nothing
  // destructive - empty, comment-only, or additive - skipped statement
  // validation, declaration matching and assertColumnUnreferenced entirely,
  // while the replay still exempted its declared column from comparison. The
  // migration could then claim a removal it never performed and pass.
  const byPath = new Map(destructive.map((entry) => [entry.path, entry]))
  for (const migration of CONTRACT_MIGRATIONS.keys()) {
    const path = join(MIGRATIONS_DIR, migration)
    if (!byPath.has(path)) byPath.set(path, { path, found: [] })
  }

  const undeclared = []
  for (const entry of byPath.values()) {
    const migration = basename(entry.path)
    const contract = CONTRACT_MIGRATIONS.get(migration)
    if (!contract) {
      undeclared.push(entry)
      continue
    }

    // Every removal in the file must be one this migration declared, and every
    // declared removal must actually appear. Both directions: an undeclared
    // extra drop is the obvious hazard, and a declaration naming something the
    // SQL does not do is a declaration nobody has kept honest.
    const statements = splitStatements(tokenizeSql(readFileSync(entry.path, 'utf8'), entry.path))

    // PER STATEMENT, never by comparing two array lengths. The length version
    // was unsound and had a live counterexample:
    // `ALTER TABLE d1_migrations DROP COLUMN x` classifies as a forbidden
    // ledger alteration and ALSO parsed as a benign column removal, so one of
    // each made the counts agree and a declaration authorized it. Walking the
    // statements together means a statement the classifier condemns must be a
    // removal IN ITS OWN RIGHT to be declarable, and the ledger no longer
    // parses as one at all.
    const neverDeclarable = []
    const removals = []
    for (const statement of statements) {
      const condemned = classifyStatement(statement)
      const removal = describeRemoval(statement)
      if (removal) removals.push(removal)
      if (condemned && !removal) neverDeclarable.push(condemned)
    }

    // A contract migration REMOVES things and does nothing else. Every
    // statement must be a recognized removal - no CREATE, no ALTER ... ADD, no
    // INSERT, nothing.
    //
    // This is the rule that closes the cascade-timing hole. The cascade-parent
    // check reads incoming foreign keys BEFORE the migration runs, so an
    // additive statement earlier in the SAME file could introduce a cascading
    // FK the check never saw, and the declared DROP TABLE would then cascade
    // undetected. Rather than teach the harness to re-derive foreign keys
    // between statements, forbid the shape entirely: if a contract migration
    // cannot create a table or add a referencing column, it cannot invent a
    // new incoming cascade. Mixed migrations were never wanted anyway - a
    // contract step is the removal half of an expand/contract pair.
    const nonRemovals = statements
      .filter((statement) => statement.length > 0)
      .filter((statement) => !describeRemoval(statement))
    if (nonRemovals.length > 0) {
      throw new Error(
        `${migration} is a contract step, so every statement in it must be a ` +
          'removal. It contains ' + nonRemovals.length + ' statement(s) that ' +
          'are not:\n' +
          nonRemovals
            .map((st) => `      ${st.map((t) => t.value).join(' ').slice(0, 90)}`)
            .join('\n') +
          '\n\nAdditive DDL belongs in its own migration. Mixing them lets a ' +
          'statement create an incoming ON DELETE CASCADE that the ' +
          'cascade-parent check - which reads the schema BEFORE this migration ' +
          'runs - cannot see, and a declared DROP TABLE would then cascade ' +
          'undetected.',
      )
    }

    if (neverDeclarable.length > 0) {
      throw new Error(
        `${migration} is declared in CONTRACT_MIGRATIONS but contains ` +
          'destructive DDL that a contract step may never include - a rebuild, ' +
          'a rename, or a write to wrangler\'s ledger:\n' +
          neverDeclarable.map((f) => `      ${f}`).join('\n') +
          '\n\nThose stay banned with no declaration: a rebuild cascade-wipes ' +
          'children on D1, and a rename has no window in which both names work.',
      )
    }

    const declared = contract.objects.map((o) =>
      o.kind === 'column' ? `column:${o.table}.${o.name}` : `${o.kind}:${o.name}`,
    )
    const actual = removals.map((r) =>
      r.kind === 'column' ? `column:${r.table}.${r.name}` : `${r.kind}:${r.name}`,
    )
    // Multiset, not set membership. `includes` matched two identical
    // `DROP ... IF EXISTS` statements against a single declaration, so a
    // repeated removal looked declared.
    const tally = (labels) => {
      const counts = new Map()
      for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
      return counts
    }
    const declaredCounts = tally(declared)
    const actualCounts = tally(actual)
    const missing = []
    const extra = []
    for (const [label, count] of declaredCounts) {
      const seen = actualCounts.get(label) ?? 0
      for (let i = seen; i < count; i++) missing.push(label)
    }
    for (const [label, count] of actualCounts) {
      const want = declaredCounts.get(label) ?? 0
      for (let i = want; i < count; i++) extra.push(label)
    }
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `${migration} does not remove what it declares.\n` +
          (extra.length ? `  removes but did not declare: ${extra.join(', ')}\n` : '') +
          (missing.length ? `  declares but does not remove: ${missing.join(', ')}\n` : '') +
          '\nThe declaration is what a reviewer reads instead of the SQL. If the ' +
          'two disagree, the declaration is worse than nothing.',
      )
    }

    for (const object of contract.objects) {
      if (object.kind === 'column') {
        assertColumnUnreferenced(object.table, object.name, migration)
      }
    }

    console.log(
      `  ${migration}: contract step, ${actual.length} object(s) removed; reads ` +
        `removed in ${contract.readsRemovedIn} (attested, not proven).`,
    )
  }

  if (undeclared.length > 0) {
    throw new Error(
      'Destructive DDL in a migration:\n' +
        undeclared
          .map((e) => `  - ${e.path}\n${e.found.map((f) => `      ${f}`).join('\n')}`)
          .join('\n') +
        '\n\ndeploy.yml applies migrations BEFORE it deploys the Worker, so ' +
        'production runs the old code against this schema - and keeps running ' +
        'it if the deploy step fails. A drop breaks it in that window.' +
        '\n\nA DROP COLUMN, DROP TRIGGER, DROP INDEX or childless DROP TABLE may ' +
        'ship as a CONTRACT STEP one release after the code that read it: add an ' +
        'entry to CONTRACT_MIGRATIONS naming every object and the PR that removed ' +
        'the reads. Rebuilds, renames and ledger writes are never declarable.',
    )
  }

  console.log(`Destructive-DDL gate: ${files.length} post-baseline migration(s) clean.`)
}

// Runs on EVERY invocation, including the common one where the branch adds no
// migrations at all and the rest of this script no-ops. Without that, a branch
// touching no SQL would exercise none of the classifier, and it could rot into
// permanently returning "nothing destructive here" without a single red run.
const DDL_GATE_CASES = [
  // --- must be caught ---
  ['DROP TABLE `x`;', true],
  ['DROP TABLE IF EXISTS "x";', true],
  ['DROP INDEX `lists_food_plan_id_unique`;', true],
  ['DROP TRIGGER `gear_items_cap`;', true],
  ['DROP VIEW `v`;', true],
  ['DROP TABLE main.`x`;', true],
  ['ALTER TABLE `lists` DROP COLUMN `food_plan_id`;', true],
  ['ALTER TABLE `lists` DROP `food_plan_id`;', true],
  ['ALTER TABLE `lists` RENAME TO `lists_old`;', true],
  ['ALTER TABLE `lists` RENAME COLUMN `a` TO `b`;', true],
  ['ALTER TABLE main.`lists` RENAME COLUMN `a` TO `b`;', true],
  // Multiline, and with drizzle's own statement-breakpoint comment attached.
  ['ALTER TABLE `lists`\n  RENAME COLUMN `a`\n  TO `b`;--> statement-breakpoint', true],
  // The 12-step rebuild, convicted by the parts rather than by a shape matcher.
  [
    'CREATE TABLE `__new_lists` (`id` text PRIMARY KEY);\n' +
      'INSERT INTO `__new_lists` SELECT `id` FROM `lists`;\n' +
      'DROP TABLE `lists`;\n' +
      'ALTER TABLE `__new_lists` RENAME TO `lists`;',
    true,
  ],
  ['PRAGMA writable_schema = ON;', true],
  ["UPDATE sqlite_master SET sql = '' WHERE name = 'lists';", true],
  ["DELETE FROM sqlite_schema WHERE name = 'lists';", true],
  // Case and whitespace are not a way out.
  ['dRoP   tAbLe   `x`;', true],
  // Schema surgery, every disguise. All of these are executable SQLite that
  // removes a column with no DDL keyword in sight; an earlier version of this
  // classifier returned "nothing destructive" for the first two.
  ['PRAGMA "writable_schema" = ON;', true],
  ['PRAGMA `writable_schema` = ON;', true],
  ['PRAGMA [writable_schema] = ON;', true],
  ["UPDATE \"sqlite_schema\" SET sql = 'CREATE TABLE x(a integer)' WHERE name = 'x';", true],
  ["UPDATE `sqlite_schema` SET sql = '' WHERE name = 'x';", true],
  ["REPLACE INTO sqlite_schema (name, sql) VALUES ('x', '');", true],
  ["WITH t AS (SELECT 1) UPDATE sqlite_schema SET sql = '' WHERE name = 'x';", true],
  // A trigger body doing the same thing. The semicolon split leaves this
  // statement attached to its CREATE TRIGGER, so a leading-keyword test misses
  // it - SQLite forbids DROP TABLE in a trigger but permits this.
  [
    'CREATE TRIGGER `mutate` AFTER INSERT ON `x` BEGIN\n' +
      "  UPDATE sqlite_schema SET sql = 'CREATE TABLE x(a integer)' WHERE name = 'x';\n" +
      'END;',
    true,
  ],

  // --- must NOT be caught ---
  ['ALTER TABLE `lists` ADD COLUMN `food_revision` integer DEFAULT 0 NOT NULL;', false],
  ['CREATE TABLE `lists` (`id` text PRIMARY KEY);', false],
  ['CREATE INDEX `i` ON `lists` (`id`);', false],
  ['CREATE UNIQUE INDEX `u` ON `lists` (`id`);', false],
  ['DELETE FROM `_packing_location_delete_state`;', false],
  ['REINDEX `lists`;', false],
  // A trigger body with statements and semicolons inside BEGIN ... END.
  [
    'CREATE TRIGGER `t` AFTER DELETE ON `packing_locations` BEGIN\n' +
      '  DELETE FROM `_packing_location_delete_state`;\n' +
      '  UPDATE `list_items` SET `pack_sort_order` = 0;\n' +
      'END;',
    false,
  ],
  // The keyword appears, but only ever as comment, string or identifier.
  ['-- DROP TABLE `lists`;\nCREATE INDEX `i` ON `lists` (`id`);', false],
  ['/* DROP TABLE `lists`; */ CREATE INDEX `i` ON `lists` (`id`);', false],
  ["INSERT INTO `notes` (`body`) VALUES ('DROP TABLE lists');", false],
  ["INSERT INTO `notes` (`body`) VALUES ('it''s a DROP TABLE, really');", false],
  // A table actually NAMED drop. Quoted, so it is a name and nothing else.
  ['CREATE TABLE `drop` (`id` text PRIMARY KEY);', false],
  ['ALTER TABLE `drop` ADD COLUMN `x` text;', false],
  ['SELECT * FROM "drop";', false],
  // Naming a column after a system table is legal and additive. Matching on
  // mere mention rather than on position used to reject all of these.
  ['CREATE TABLE `settings` ("writable_schema" integer);', false],
  ['CREATE TABLE `settings` (`sqlite_schema` text);', false],
  ['INSERT INTO `audit` (`sql`) SELECT `sql` FROM sqlite_schema;', false],
  ['INSERT OR REPLACE INTO `settings` (`k`) VALUES (1);', false],
  // ...but writing THROUGH those spellings is still the same operation.
  ["INSERT OR REPLACE INTO sqlite_schema (name) VALUES ('x');", true],
  // Schema-qualified and conflict-clause forms. Every one of these is valid
  // SQLite that an earlier version of this classifier returned nothing for.
  ['PRAGMA main.writable_schema = ON;', true],
  ['PRAGMA "main"."writable_schema" = ON;', true],
  ["UPDATE main.sqlite_schema SET sql = '' WHERE name = 'lists';", true],
  ["UPDATE `main`.`sqlite_master` SET sql = '' WHERE name = 'lists';", true],
  ["INSERT OR IGNORE INTO sqlite_schema (name) VALUES ('x');", true],
  ["UPDATE OR IGNORE sqlite_schema SET sql = '';", true],
  ["UPDATE OR ROLLBACK main.sqlite_schema SET sql = '';", true],
  ["DELETE FROM main.sqlite_schema WHERE name = 'x';", true],
  // Qualified names that are NOT the system schema stay legal.
  ['UPDATE main.`list_items` SET `pack_sort_order` = 0;', false],
  ["INSERT OR IGNORE INTO main.`settings` (`k`) VALUES ('x');", false],
  // SQLite accepts a single-quoted STRING where an identifier belongs. Both of
  // these execute, and both used to return nothing.
  ["PRAGMA 'writable_schema' = ON;", true],
  ["UPDATE 'sqlite_schema' SET sql = '' WHERE name = 'x';", true],
  ["DELETE FROM main.'sqlite_master' WHERE name = 'x';", true],
  // ...but a string in a VALUE position is just a value.
  ["INSERT INTO `notes` (`body`) VALUES ('sqlite_schema');", false],
  ["INSERT INTO `notes` (`body`) VALUES ('writable_schema');", false],
  // A table genuinely NAMED after an operation keyword. Valid SQLite, additive,
  // and it was being reported as a rename.
  ['ALTER TABLE rename ADD COLUMN `y` text;', false],
  ['ALTER TABLE main.rename ADD COLUMN `y` text;', false],
  ['ALTER TABLE `add` ADD COLUMN `y` text;', false],
  // The same shapes, still caught when they really are destructive.
  ['ALTER TABLE rename RENAME TO `other`;', true],
  ['ALTER TABLE main.rename DROP COLUMN `y`;', true],
  // SQLite lets a column's declared TYPE be any word sequence, so this is a
  // legal additive table with a column typed `REPLACE sqlite_schema`.
  ['CREATE TABLE `d` (`x` REPLACE sqlite_schema);', false],
  ['CREATE TABLE `d` (`x` UPDATE sqlite_master);', false],
  ['CREATE INDEX `i` ON `d` (`x`) WHERE `x` <> 0;', false],
  // Any ALTER of wrangler's ledger, additive or not. It is excluded from every
  // snapshot, so nothing downstream would ever notice the change.
  ['ALTER TABLE main.d1_migrations ADD COLUMN `poison` text;', true],
  ['ALTER TABLE `d1_migrations` ADD COLUMN `poison` text;', true],
  ['ALTER TABLE "d1_migrations" ADD COLUMN `poison` text;', true],
  ["ALTER TABLE 'd1_migrations' ADD COLUMN `poison` text;", true],
  // A normal table of our own is still additive and fine.
  ['ALTER TABLE `lists` ADD COLUMN `poison` text;', false],
  // A trigger body is still scanned - it really can contain a write.
  [
    'CREATE TRIGGER `t` AFTER INSERT ON `x` BEGIN\n' +
      "  UPDATE sqlite_schema SET sql = '' WHERE name = 'x';\n" +
      'END;',
    true,
  ],
]

// Sorting by migration number is STABLE, so two entries with the SAME number
// keep whatever order they were written in - and the whole point of resolving by
// number was to stop declaration order mattering. Two rewrites of one column by
// one migration also cannot be expressed honestly: the check compares the state
// before that migration against the state after it, so only the net
// `before -> after` is observable.
//
// Also verifies the chain joins up. If 0021 says A -> B, then a later rewrite of
// the same column must start at B; a declaration starting somewhere else means
// one of the two entries is wrong about reality, and silently preferring either
// would seed a value the database never actually holds.
const validateExpectedChanges = (knownMigrations) => {
  const problems = []
  const groups = new Map()

  for (const change of EXPECTED_CHANGES) {
    // A declaration naming a migration that does not exist is worse than
    // useless. alreadyApplied() answers "not post-baseline, so it has already
    // run" for an unknown name, so the fixture seeds `after` - while the change
    // never becomes active, so no rewrite is expected. A typo therefore describes
    // a migration that already happened and asserts nothing, which is exactly
    // the shape that lets a broken no-op migration pass.
    if (!knownMigrations.has(change.migration)) {
      problems.push(
        `${change.migration} is named by an EXPECTED_CHANGES entry but no such ` +
          'migration exists. A typo here silently disables the assertion.',
      )
      continue
    }

    // Grouped by the fixture row a declaration RESOLVES to, not by the key
    // expression used to reach it. Keying by the expression let two entries
    // target one row through different columns (id here, slug there) without
    // looking like duplicates - and declaration order decided the outcome again.
    const matches = FIXTURES.map((entry, index) => ({ entry, index })).filter(
      ({ entry: [table, row] }) =>
        table === change.table && row[change.key.column] === change.key.value,
    )
    if (matches.length !== 1) {
      problems.push(
        `${change.migration}: ${change.table} where ${change.key.column} = ` +
          `${JSON.stringify(change.key.value)} matches ${matches.length} fixture rows; ` +
          'it must match exactly one, or the declaration asserts nothing definite.',
      )
      continue
    }

    const key = `fixture#${matches[0].index}|${change.column}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(change)
  }

  for (const [key, changes] of groups) {
    const byMigration = new Map()
    for (const change of changes) {
      if (byMigration.has(change.migration)) {
        problems.push(
          `${key}: ${change.migration} declares more than one rewrite of this ` +
            'column. Only the net before -> after is observable, so collapse them into one entry.',
        )
      }
      byMigration.set(change.migration, change)
    }

    const ordered = [...changes].sort(
      (a, b) => migrationNumber(a.migration) - migrationNumber(b.migration),
    )
    for (const [i, next] of ordered.slice(1).entries()) {
      const previous = ordered[i]
      if (previous.after !== next.before) {
        problems.push(
          `${key}: ${previous.migration} leaves ${JSON.stringify(previous.after)} but ` +
            `${next.migration} declares it starts from ${JSON.stringify(next.before)}. ` +
            'One of them does not match what the database actually holds.',
        )
      }
    }
  }

  // Every other declaration list is keyed by migration filename too, and every
  // one of them silently does nothing when the name is wrong.
  for (const [label, entries] of [
    ['DROPPED_TABLES', DROPPED_TABLES],
    ['DROPPED_COLUMNS', DROPPED_COLUMNS],
    ['DROPPED_SCHEMA_OBJECTS', DROPPED_SCHEMA_OBJECTS],
    ['EXPECTED_TYPE_CHANGES', EXPECTED_TYPE_CHANGES],
    ['TRANSIENT_TABLES', TRANSIENT_TABLES],
    ['REQUIRE_EMPTY_TABLE', REQUIRE_EMPTY_TABLE],
    ['POST_CHECKS', POST_CHECKS],
    // Keyed by filename like the rest, and MORE dangerous when wrong: a typo
    // here is not merely inert. alreadyApplied() treats any filename it cannot
    // find in the directory as already applied, so a misspelled future contract
    // would retroactively excuse a transient table's absence in the very pass
    // that creates it.
    ['CONTRACT_MIGRATIONS', [...CONTRACT_MIGRATIONS.keys()].map((migration) => ({ migration }))],
  ]) {
    for (const entry of entries) {
      if (!knownMigrations.has(entry.migration)) {
        problems.push(
          `${label} names migration ${entry.migration}, which does not exist. ` +
            'The entry can never activate.',
        )
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Migration declarations are inconsistent:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    )
  }
}

// Both declaration orders of the same chain must give the same answer. That is
// the whole point of resolving by migration number, and reversing the order is
// what exposed the bug this replaced.
const selfTestExpectedValues = () => {
  const chain = [
    { migration: '0021_a.sql', before: 'A', after: 'B' },
    { migration: '0022_b.sql', before: 'B', after: 'C' },
  ]
  const reversed = [...chain].reverse()
  const cases = [
    // Nothing applied yet - testing 0021. Must be A, its declared start.
    [() => false, 'A'],
    // 0021 has run - testing 0022. Must be B.
    [(m) => m === '0021_a.sql', 'B'],
    // Both have run - a later migration's pass. Must be C.
    [() => true, 'C'],
  ]
  const failures = []
  for (const [alreadyApplied, want] of cases) {
    for (const [label, order] of [['declared', chain], ['reversed', reversed]]) {
      const got = resolveExpectedValue(order, alreadyApplied)
      if (got !== want) {
        failures.push(`${label} order gave ${got}, want ${want}`)
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(
      'EXPECTED_CHANGES resolution is broken - chained rewrites do not resolve ' +
        `by migration order:\n${failures.map((f) => `  - ${f}`).join('\n')}`,
    )
  }
}

const selfTestDdlGate = () => {
  const failures = []
  for (const [sql, shouldFlag] of DDL_GATE_CASES) {
    let flagged
    try {
      flagged = findDestructiveDdl(sql, 'self-test').length > 0
    } catch (error) {
      failures.push(`threw on: ${sql}\n      ${error.message}`)
      continue
    }
    if (flagged !== shouldFlag) {
      failures.push(
        `${shouldFlag ? 'MISSED' : 'FALSE POSITIVE'} on: ${sql.replaceAll('\n', ' ')}`,
      )
    }
  }
  // Unterminated constructs must fail closed rather than scan what is left.
  for (const [sql, what] of [
    ["INSERT INTO `n` VALUES ('oops", 'string literal'],
    ['/* never closed', 'block comment'],
    ['CREATE TABLE `never-closed', 'quoted identifier'],
  ]) {
    let threw = false
    try {
      findDestructiveDdl(sql, 'self-test')
    } catch {
      threw = true
    }
    if (!threw) failures.push(`did not fail closed on an unterminated ${what}`)
  }

  if (failures.length > 0) {
    throw new Error(
      'The destructive-DDL classifier is broken - its own regression cases ' +
        `fail:\n${failures.map((f) => `  - ${f}`).join('\n')}`,
    )
  }
}

// The constraint comparator is tested DIRECTLY with synthetic snapshots.
// An end-to-end "rebuild that drops an FK must fail" test would stay green
// with the comparator absent, because the destructive-DDL gate rejects the
// rebuild before any snapshot is taken - so these are the only tests that
// prove the comparator itself works.
const selfTestConstraintCompare = () => {
  const failures = []

  // --- extractCheckClauses ---
  const checkCases = [
    ['CREATE TABLE t (a integer CHECK (a > 0))', ['(a > 0)']],
    [
      'CREATE TABLE t (a integer CHECK (a > 0), b text CHECK (length(b) <= 128))',
      ['(a > 0)', '(length(b) <= 128)'],
    ],
    // Nested parens and a paren inside a string must not end the clause.
    ["CREATE TABLE t (a text CHECK (a in ('x)', 'y') and (1 = 1)))", ["(a in ('x)', 'y') and (1 = 1))"]],
    // The keyword inside a string, a comment, or an identifier is not a CHECK.
    ["CREATE TABLE t (a text default 'check (a > 0)')", []],
    ['CREATE TABLE t (a integer) -- check (a > 0)', []],
    ['CREATE TABLE t (`check` integer)', []],
    // typeof-style clause from 0017, whitespace collapsed.
    [
      "CREATE TABLE t (day integer CHECK (typeof(day) = 'integer'\n    AND day >= 1))",
      ["(typeof(day) = 'integer' AND day >= 1)"],
    ],
    // A paren hidden in a comment or [identifier] must not truncate the
    // clause - a truncated label would let a weakened CHECK compare equal.
    ['CREATE TABLE t (a integer CHECK (a /* ) */ >= 1))', ['(a >= 1)']],
    ['CREATE TABLE t (a integer CHECK (a /* ) */ >= 0))', ['(a >= 0)']],
    ['CREATE TABLE t (a integer CHECK ([a)] >= 1))', ['([a)] >= 1)']],
    // Whitespace INSIDE a string literal is semantic and survives verbatim.
    ["CREATE TABLE t (a text CHECK (a = 'x  y'))", ["(a = 'x  y')"]],
    ["CREATE TABLE t (a text CHECK (a = 'x y'))", ["(a = 'x y')"]],
    // Comments between CHECK and its paren, and trailing inside the clause.
    ['CREATE TABLE t (a integer CHECK -- c\n (a > 0))', ['(a > 0)']],
    ['CREATE TABLE t (a integer CHECK (a > 0 -- tail\n))', ['(a > 0)']],
    // JS \\s is wider than SQLite whitespace: U+00A0 is part of an
    // IDENTIFIER to SQLite, so `a\u00A0` is a different column than `a` and
    // the two labels must stay distinct.
    ['CREATE TABLE t (`a\u00A0` integer CHECK (a\u00A0 >= 1))', ['(a\u00A0 >= 1)']],
    ['CREATE TABLE t (a integer CHECK (a >= 1))', ['(a >= 1)']],
    // `$` and codepoints above 0x7F are identifier characters to SQLite, so
    // these REFERENCES targets contain no CHECK keyword at all - misreading
    // their tails would mint a phantom CHECK label.
    ['CREATE TABLE t (a integer REFERENCES parent\u00A0check(a))', []],
    ['CREATE TABLE t (a integer REFERENCES parent$check(a))', []],
  ]
  for (const [sql, want] of checkCases) {
    const got = extractCheckClauses(sql)
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(`extractCheckClauses(${sql}) -> ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
    }
  }
  for (const sql of ["CREATE TABLE t (a text CHECK ('never", 'CREATE TABLE t (a CHECK (1']) {
    let threw = false
    try {
      extractCheckClauses(sql)
    } catch {
      threw = true
    }
    if (!threw) failures.push(`did not fail closed on: ${sql}`)
  }

  // --- groupForeignKeyRows: composite FK, id renumbering, row order ---
  const fkRows = [
    { tbl: 'list_items', fkid: 0, seq: 1, ref: 'gear_items', fromCol: 'user_id', toCol: 'user_id', onUpdate: 'NO ACTION', onDelete: 'CASCADE' },
    { tbl: 'list_items', fkid: 0, seq: 0, ref: 'gear_items', fromCol: 'gear_item_id', toCol: 'id', onUpdate: 'NO ACTION', onDelete: 'CASCADE' },
    { tbl: 'list_items', fkid: 1, seq: 0, ref: 'lists', fromCol: 'list_id', toCol: 'id', onUpdate: 'NO ACTION', onDelete: 'CASCADE' },
  ]
  const renumbered = fkRows.map((r) => ({ ...r, fkid: r.fkid === 0 ? 7 : 3 })).reverse()
  const a = groupForeignKeyRows(fkRows)
  const b = groupForeignKeyRows(renumbered)
  if (JSON.stringify([...a]) !== JSON.stringify([...b])) {
    failures.push('groupForeignKeyRows is sensitive to fk id renumbering or row order')
  }
  const expectLabel = 'fk (gear_item_id,user_id) -> gear_items(id,user_id) on_update=NO ACTION on_delete=CASCADE'
  if (!(a.get('list_items') ?? []).includes(expectLabel)) {
    failures.push(`composite FK label wrong: ${JSON.stringify(a.get('list_items'))}`)
  }

  // --- diffConstraints ---
  const before = new Map([
    ['list_items', ['check (quantity > 0)', expectLabel]],
    ['gone_table', ['check (x > 0)']],
  ])
  const dropFk = new Map([['list_items', ['check (quantity > 0)']], ['gone_table', ['check (x > 0)']]])
  const dropCheck = new Map([['list_items', [expectLabel]], ['gone_table', ['check (x > 0)']]])
  const additive = new Map([
    ['list_items', ['check (quantity > 0)', 'check (quantity < 100)', expectLabel].sort()],
    ['gone_table', ['check (x > 0)']],
    ['new_table', ['check (y > 0)']],
  ])
  if (diffConstraints(before, dropFk, new Set()).length !== 1) {
    failures.push('a dropped FK was not reported')
  }
  if (diffConstraints(before, dropCheck, new Set()).length !== 1) {
    failures.push('a dropped CHECK was not reported')
  }
  if (diffConstraints(before, additive, new Set()).length !== 0) {
    failures.push('a purely additive change was reported as a drop')
  }
  if (diffConstraints(before, new Map([['list_items', before.get('list_items')]]), new Set(['gone_table'])).length !== 0) {
    failures.push('a grandfathered-dropped table was not skipped')
  }

  if (failures.length > 0) {
    throw new Error(
      'The constraint comparator is broken - its own regression cases ' +
        `fail:\n${failures.map((f) => `  - ${f}`).join('\n')}`,
    )
  }
}

// The generated per-pass config has to be the tracked one with its migration
// paths moved, and nothing else changed. Pure, so it runs without a database.
const selfTestConfigRebase = () => {
  const failures = []
  const cases = [
    [
      { binding: 'DB', database_name: 'grampacker', database_id: 'x', migrations_dir: 'migrations' },
      { binding: 'DB', database_name: 'grampacker', database_id: 'x', migrations_dir: 'staged' },
    ],
    // Every unrelated key survives, including ones wrangler adds later.
    [
      { binding: 'DB', database_id: 'x', preview_database_id: 'p', remote: true, migrations_dir: 'migrations' },
      { binding: 'DB', database_id: 'x', preview_database_id: 'p', remote: true, migrations_dir: 'staged' },
    ],
    // An explicit ledger table is carried through untouched.
    [
      { binding: 'DB', database_id: 'x', migrations_dir: 'migrations', migrations_table: 'my_ledger' },
      { binding: 'DB', database_id: 'x', migrations_dir: 'staged', migrations_table: 'my_ledger' },
    ],
    // A pattern is rebased onto the staged directory, not rejected.
    [
      { binding: 'DB', database_id: 'x', migrations_dir: 'migrations', migrations_pattern: 'migrations/*/up.sql' },
      { binding: 'DB', database_id: 'x', migrations_dir: 'staged', migrations_pattern: 'staged/*/up.sql' },
    ],
    // "./migrations" and "migrations" are one directory to wrangler, so they
    // must be one directory here.
    [
      { binding: 'DB', database_id: 'x', migrations_dir: './migrations', migrations_pattern: './migrations/*.sql' },
      { binding: 'DB', database_id: 'x', migrations_dir: 'staged', migrations_pattern: 'staged/*.sql' },
    ],
    // Doubled separators normalize away rather than producing an empty segment.
    [
      { binding: 'DB', database_id: 'x', migrations_dir: 'migrations', migrations_pattern: 'migrations//nested/*.sql' },
      { binding: 'DB', database_id: 'x', migrations_dir: 'staged', migrations_pattern: 'staged/nested/*.sql' },
    ],
    // Windows separators, and mixed ones. These fail if normalization runs
    // before backslash conversion: the pattern stays one component and the
    // containment test compares the wrong shapes.
    [
      { binding: 'DB', database_id: 'x', migrations_dir: 'migrations', migrations_pattern: 'migrations\\nested\\*.sql' },
      { binding: 'DB', database_id: 'x', migrations_dir: 'staged', migrations_pattern: 'staged/nested/*.sql' },
    ],
    [
      { binding: 'DB', database_id: 'x', migrations_dir: '.\\migrations', migrations_pattern: 'migrations\\deep/nested\\*.sql' },
      { binding: 'DB', database_id: 'x', migrations_dir: 'staged', migrations_pattern: 'staged/deep/nested/*.sql' },
    ],
  ]
  for (const [input, want] of cases) {
    let got
    try {
      got = rebaseD1Entry(input, 'staged')
    } catch (error) {
      failures.push(`${JSON.stringify(input)} threw: ${error.message}`)
      continue
    }
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(`${JSON.stringify(input)} -> ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
    }
  }
  // Patterns that do not sit under migrations_dir are wrangler's own error
  // case; the harness must not paper over them. `migrations-old` is the one a
  // raw startsWith accepts and must not.
  for (const pattern of ['elsewhere/*.sql', 'migrations-old/*.sql', '../migrations/*.sql']) {
    try {
      rebaseD1Entry({ migrations_dir: 'migrations', migrations_pattern: pattern }, 'staged')
      failures.push(`pattern outside migrations_dir was accepted: ${pattern}`)
    } catch {
      // expected
    }
  }
  // Wrangler rejects a pattern with no migrations_dir; so must this.
  try {
    rebaseD1Entry({ migrations_pattern: 'migrations/*.sql' }, 'staged')
    failures.push('a pattern with no migrations_dir was accepted')
  } catch {
    // expected
  }

  if (failures.length > 0) {
    throw new Error(
      'The generated wrangler config would not match the tracked one:\n' +
        failures.map((f) => `  - ${f}`).join('\n'),
    )
  }
}

// Batched reads are only safe if a result can be trusted to be the result of
// the statement it is attributed to. Pure: fabricated result sets, no database.
const selfTestMarkedBatch = () => {
  const failures = []
  const nonce = 'n'
  const marked = (i) => [{ __batch_marker: `${nonce}:${i}` }]
  const good = [marked(0), [{ a: 1 }], marked(1), [{ b: 2 }]]

  const parsed = parseMarkedBatch(2, good, nonce)
  if (JSON.stringify(parsed) !== JSON.stringify([[{ a: 1 }], [{ b: 2 }]])) {
    failures.push(`well-formed batch parsed as ${JSON.stringify(parsed)}`)
  }

  const cases = [
    ['a missing result set', [marked(0), [{ a: 1 }], marked(1)]],
    ['an extra result set', [...good, [{ c: 3 }]]],
    ['reordered results', [marked(1), [{ b: 2 }], marked(0), [{ a: 1 }]]],
    ['a marker from another call', [[{ __batch_marker: 'other:0' }], [{ a: 1 }], marked(1), [{ b: 2 }]]],
    ['a marker row that is not a marker', [[{ a: 1 }], [{ a: 1 }], marked(1), [{ b: 2 }]]],
    ['a marker set with two rows', [[...marked(0), { __batch_marker: `${nonce}:0` }], [{ a: 1 }], marked(1), [{ b: 2 }]]],
    ['a marker set with no rows', [[], [{ a: 1 }], marked(1), [{ b: 2 }]]],
    ['a marker row carrying extra columns', [[{ __batch_marker: `${nonce}:0`, a: 1 }], [{ a: 1 }], marked(1), [{ b: 2 }]]],
  ]
  for (const [label, sets] of cases) {
    try {
      parseMarkedBatch(2, sets, nonce)
      failures.push(`${label} was accepted`)
    } catch {
      // expected
    }
  }
  if (failures.length > 0) {
    throw new Error(
      'Batched reads cannot be trusted - their position check is broken:\n' +
        failures.map((f) => `  - ${f}`).join('\n'),
    )
  }
}

// A batch can fail for a reason no single statement reproduces (its size, say).
// That case must read as a batch problem rather than as a false accusation
// against statement 1 - and the attributable case must still name its
// statement. Both are exercised with an injected runner, because an output cap
// is not a reliable forcing function: several individual result sets are large
// enough to trip a small cap on their own, which would make the replay
// attribute correctly and the experiment look like a bug.
const selfTestBatchAttribution = () => {
  const failures = []

  const onlyFailsInBatches = (statements) => {
    if (statements.length > 1) throw new Error('stdout maxBuffer length exceeded')
    return [[{ ok: 1 }]]
  }
  try {
    runOneBatch(['select 1 as a', 'select 2 as b'], onlyFailsInBatches)
    failures.push('a batch-level failure was not reported at all')
  } catch (error) {
    if (!/batch itself is the problem/.test(error.message)) {
      failures.push(`a batch-level failure was misattributed:\n${error.message}`)
    }
    if (/at statement \d+ of/.test(error.message)) {
      failures.push('a batch-level failure was blamed on a specific statement')
    }
  }

  const failsOnBadTable = (statements) => {
    if (statements.some((sql) => sql.includes('from bad'))) {
      throw new Error('no such table: bad')
    }
    return statements.map(() => [{ ok: 1 }])
  }
  try {
    runOneBatch(['select 1 as a', 'select * from bad'], failsOnBadTable)
    failures.push('an attributable failure was not reported')
  } catch (error) {
    if (!/at statement 2 of 2/.test(error.message) || !/select \* from bad/.test(error.message)) {
      failures.push(`an attributable failure did not name its statement:\n${error.message}`)
    }
  }

  if (failures.length > 0) {
    throw new Error(
      'Batched-read failure attribution is broken:\n' +
        failures.map((f) => `  - ${f}`).join('\n'),
    )
  }
}

const run = (command, args) => {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Batched reads return one result set per statement; Node's 1 MB default
      // would turn a large snapshot into an ENOBUFS that reads like a SQL
      // failure. 500 statements measured 63 KB, so this is far above need.
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (error) {
    // execFileSync's own message is just the command line. wrangler reports
    // SQL errors as JSON on stdout and everything else on stderr, so surface
    // both or the real reason is invisible.
    const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${command} ${args[0]} ${args[1]} failed:\n${detail || error.message}`)
  }
}

let persistDir = ''
// The generated per-pass config (see writeWranglerConfig). Wrangler resolves
// migrations_dir relative to it, which is what lets a pass stage its own
// migrations directory instead of editing the tracked one.
let configPath = ''

// The installed binary directly, not through `npx`: npx re-resolves the
// package on every launch, which measured 0.83-1.32 s against 0.61-0.82 s for
// the bin. That difference is smaller than its own spread, so this is a free
// win rather than a meaningful one - taken because the fallback costs nothing.
const WRANGLER_BIN = join('node_modules', '.bin', 'wrangler')

// The INSTALLED binary, or nothing. `npx wrangler` was the obvious fallback and
// is the wrong one: npx resolves - and will happily fetch - whatever version it
// finds, so a machine missing the install would prove its migrations against a
// CLI the lockfile never pinned. This whole script exists to say what
// production will do, and it cannot say that through an unknown tool version.
// (Using the bin directly is also marginally faster than npx: measured
// 0.61-0.82 s against 0.83-1.32 s per launch, a difference smaller than its own
// spread. Speed is the side benefit here, not the reason.)
const requireWranglerBin = () => {
  if (existsSync(WRANGLER_BIN)) return WRANGLER_BIN
  throw new Error(
    `${WRANGLER_BIN} is missing, so this check cannot run against the wrangler ` +
      'version package-lock.json pins. Run `npm ci`. (It deliberately does NOT ' +
      'fall back to `npx wrangler`, which may resolve or download a different ' +
      'version - proving a migration against an unpinned CLI proves nothing ' +
      'about the deploy.)',
  )
}

const wrangler = (args) =>
  run(requireWranglerBin(), [...args, '--config', configPath, '--persist-to', persistDir])

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

// Read-only statements, run in ONE wrangler launch.
//
// `d1 execute --file` has always returned one result set per statement, in
// order - snapshot() has relied on that since it was written. What cost 132 of
// this script's 213 seconds was calling it ONE statement at a time: a ~0.9 s
// process boot per microsecond query, 136 times a run. Nothing here leaves D1;
// the statements are the same statements, run by the same engine, in fewer
// processes. Measured 2026-09-03 against wrangler 4.120.0: 25 statements
// batched 1.04 s, the same 25 individually 24.25 s, results byte-identical.
//
// Two rules, and they are the whole contract:
//   1. READ-ONLY. A batch never contains a statement that writes. Seeding and
//      every POST_CHECKS probe keep their own launch.
//   2. ONE STATE. Every statement in a batch observes the same database - no
//      seed, no probe, no `migrations apply` in between - or the comparison
//      would be assembled from rows that never coexisted.
//
// The cap counts PAYLOAD statements; markers double it, so 200 here is 400
// statements on the wire. 500 in one file measured 2.03 s and parsed cleanly,
// so this is comfort rather than a limit found by hitting it. Chunking is
// positional, so results stay ordered across chunks.
const MAX_BATCH_STATEMENTS = 200

// Wrangler reports a failing statement as a JSON error object and NO result
// array (verified: a `no such table` at position 3 of 5 exits 1 with
// `{"error":{"text":"no such table: ..."}}` and nothing else), so a batch fails
// loud. What it does not say is WHICH statement failed. Replaying the batch one
// statement at a time finds it - only on the failure path, where an extra
// second does not matter, and safe because batches are read-only.
//
// `exec` is a parameter only so the self-tests can inject a runner whose
// failure shape is exact; production always passes the default.
const attributeBatchFailure = (statements, error, exec = execSql) => {
  for (const [i, sql] of statements.entries()) {
    try {
      exec([sql])
    } catch (individual) {
      return new Error(
        `A batched read failed at statement ${i + 1} of ${statements.length}:\n` +
          `  ${sql}\n${individual.message}`,
      )
    }
  }
  return new Error(
    'A batched read failed, but every statement succeeds on its own. The batch ' +
      `itself is the problem (size, or a statement that is not read-only):\n${error.message}`,
  )
}

const expectedMarker = (nonce, i) => `${nonce}:${i}`

const isMarkerSet = (set, expected) =>
  Array.isArray(set) &&
  set.length === 1 &&
  set[0] !== null &&
  typeof set[0] === 'object' &&
  Object.keys(set[0]).length === 1 &&
  set[0].__batch_marker === expected

// Pure: given the marker-interleaved result sets, return the real ones or
// throw. Split out so the position check has self-tests that need no database.
//
// What this proves, stated exactly: the marker-bearing POSITIONS arrived in the
// order they were sent, each carrying this call's nonce, and the set count is
// right. That every payload belongs to the marker before it rests on wrangler
// returning one result set per statement in statement order - the contract
// snapshot() has always relied on, re-verified against wrangler 4.120.0. The
// markers turn a silent violation of that contract into a loud one; they do not
// replace it.
const parseMarkedBatch = (count, sets, nonce) => {
  if (sets.length !== count * 2) {
    throw new Error(
      `A batched read returned ${sets.length} result sets for ${count} statements ` +
        `(expected ${count * 2} with markers). Results may be missing or extra.`,
    )
  }
  const results = []
  for (let i = 0; i < count; i += 1) {
    // Exactly one row, exactly one column, exactly this nonce. A looser test -
    // reading [0].__batch_marker off whatever arrived - would accept a payload
    // result set that happens to carry the column, which is precisely the
    // confusion the marker exists to rule out.
    if (!isMarkerSet(sets[i * 2], expectedMarker(nonce, i))) {
      throw new Error(
        `A batched read came back out of order or malformed: position ${i} ` +
          `should have been the single-row marker "${expectedMarker(nonce, i)}", ` +
          `and was ${String(JSON.stringify(sets[i * 2])).slice(0, 200)}.`,
      )
    }
    results.push(sets[i * 2 + 1])
  }
  return results
}

const runOneBatch = (statements, exec = execSql) => {
  // A per-call nonce, so a marker can only satisfy the call that wrote it.
  const nonce = randomUUID()
  const marked = []
  statements.forEach((sql, i) => {
    marked.push(`select '${expectedMarker(nonce, i)}' as __batch_marker`)
    marked.push(sql)
  })
  let sets
  try {
    sets = exec(marked)
  } catch (error) {
    throw attributeBatchFailure(statements, error, exec)
  }
  return parseMarkedBatch(statements.length, sets, nonce)
}

const batchReadSql = (statements) => {
  const results = []
  for (let i = 0; i < statements.length; i += MAX_BATCH_STATEMENTS) {
    results.push(...runOneBatch(statements.slice(i, i + MAX_BATCH_STATEMENTS)))
  }
  return results
}


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

// The other half of expectSqlError: assert a probe SELECT returns exactly the
// rows expected. Needed for probes that assert a fact about the schema rather
// than a constraint - SQLite's RAISE() only works inside a trigger program, so
// a schema fact cannot be phrased as "this statement must fail".
const expectSqlRows = (statement, expected) => {
  let rows
  try {
    rows = execSql([statement])[0]
  } catch (error) {
    return `could not be run:\n${error.message}`
  }
  const actual = JSON.stringify(rows)
  const wanted = JSON.stringify(expected)
  return actual === wanted ? null : `returned ${actual}, expected ${wanted}`
}

// The before-snapshot, rewritten to what it SHOULD look like after the new
// migrations: every EXPECTED_CHANGES entry whose migration is in the tested
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
      // Both sides are already canonicalized (see canonicalize()), so
      // re-stringifying a rewritten row here renders identically to an
      // untouched one - no JS-vs-SQLite formatting skew either way.
      return modified ? JSON.stringify(row) : json
    })
    // Re-sort: the rewrite can change the rows' relative string order.
    expected.set(table, [...rewritten].sort())
  }
  return expected
}

const applyMigrations = () => wrangler(['d1', 'migrations', 'apply', DB, '--local'])

// Every read below is a SQL constant and a parser, rather than a helper that
// runs its own query, so several can ride one wrangler launch (see
// batchReadSql). The SQL and the parsing are exactly what they were when each
// helper owned both; only the packaging moved. There are deliberately no
// single-read wrappers left over: once checkOneMigration reads in batches,
// nothing calls them, and an unused wrapper is a dead object inviting the next
// author to reintroduce a launch per statement.
const TABLES_SQL = `select m.name from sqlite_master m where ${appTablesFilter('m')}`
const parseTables = (rows) => rows.map((row) => row.name)


// Triggers and named indexes on our own tables. A table rebuild drops these
// along with the old table, and drizzle-kit cannot regenerate the hand-written
// ones because they are not in its snapshot - which is exactly how the
// `lists_user_cap` trigger nearly vanished in migration 0009. Implicit
// sqlite_autoindex_* entries are excluded: they are recreated automatically and
// their numbering is not stable across a rebuild.
const SCHEMA_OBJECTS_SQL =
  "select m.type, m.name, m.tbl_name from sqlite_master m where m.type in ('trigger', 'index') " +
  "and m.name not glob 'sqlite_*' and m.tbl_name not glob 'sqlite_*' " +
  "and m.tbl_name not glob '_cf_*' and m.tbl_name <> 'd1_migrations'"
const parseSchemaObjects = (rows) =>
  rows.map(({ type, name, tbl_name }) => ({ label: `${type} ${name}`, table: tbl_name }))


// Maps table -> Set of column names, as the schema actually stands right now.
const COLUMNS_SQL =
  'select m.name as tbl, p.name as col from sqlite_master m ' +
  `join pragma_table_info(m.name) p where ${appTablesFilter('m')}`
const parseColumns = (rows) => {
  const byTable = new Map()
  for (const { tbl, col } of rows) {
    if (!byTable.has(tbl)) byTable.set(tbl, new Set())
    byTable.get(tbl).add(col)
  }
  return byTable
}


// Every column's DECLARED type, as "table.column" -> type. Guards the one hole
// that canonicalize() opens: because the value comparison now ignores numeric
// FORMATTING, an unintended integer -> real rebuild of some other column would
// no longer show up as a changed value (45000 vs 45000.0 compare equal). The
// declared type is what catches that instead, and it is a stronger check than
// the one it replaces - previously nothing verified column types at all.
const COLUMN_TYPES_SQL =
  'select m.name as tbl, p.name as col, p.type as type from sqlite_master m ' +
  `join pragma_table_info(m.name) p where ${appTablesFilter('m')}`
const parseColumnTypes = (rows) =>
  new Map(rows.map(({ tbl, col, type }) => [`${tbl}.${col}`, String(type).toUpperCase()]))


// ---------------------------------------------------------------------------
// CHECK and FOREIGN KEY constraints. Everything above watches rows, columns,
// types, triggers and indexes - but a hand-written rebuild that silently
// dropped `list_items_gear_same_owner_fk` would have passed every one of
// those assertions, and the composite same-owner FKs are the structural
// backstop the whole authorization story leans on. These snapshots close
// that hole. There is deliberately NO declaration list to excuse a missing
// constraint: post-baseline migrations cannot drop or rebuild anything (the
// DDL gate), so a constraint that vanishes means the gate was edited or
// bypassed, and the only correct answer is a hard failure.

// Composite FKs come out of pragma_foreign_key_list as one row per column
// pair sharing an `id`. Grouping by id and sorting the LABELS makes the
// snapshot immune to id renumbering and row order - only the constraint's
// meaning is compared. Pure, for the self-tests.
const groupForeignKeyRows = (rows) => {
  const groups = new Map()
  for (const r of rows) {
    const key = `${r.tbl}\0${r.fkid}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const byTable = new Map()
  for (const group of groups.values()) {
    group.sort((a, b) => a.seq - b.seq)
    const first = group[0]
    const label =
      `fk (${group.map((r) => r.fromCol).join(',')}) -> ` +
      `${first.ref}(${group.map((r) => r.toCol).join(',')}) ` +
      `on_update=${first.onUpdate} on_delete=${first.onDelete}`
    if (!byTable.has(first.tbl)) byTable.set(first.tbl, [])
    byTable.get(first.tbl).push(label)
  }
  for (const labels of byTable.values()) labels.sort()
  return byTable
}

// SQLite's whitespace is the ASCII set (0x09-0x0D and space) - JS \s is
// WIDER (it matches U+00A0 and friends, which SQLite treats as identifier
// characters). Using \s here would normalize `a` and `a\u00A0` - two
// DIFFERENT columns - to the same label, letting a swapped-column CHECK
// compare equal. So the scanner speaks SQLite's definition, not JS's.
const isSqlSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v'

// SQLite's unquoted-identifier characters are wider than JS \w too: `$` and
// every codepoint above 0x7F are legal in an identifier. Scanning words with
// [A-Za-z0-9_] alone would split `parent\u00A0check` into two words and
// misread its tail as the CHECK keyword - turning a REFERENCES clause into a
// phantom CHECK whose label could shadow a real one.
const isIdentStart = (c) => /[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 0x7f
const isIdentChar = (c) => /[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) > 0x7f

// CHECK clauses out of a CREATE TABLE's stored SQL. A tiny scanner rather
// than a regex: the keyword must be found OUTSIDE strings, quoted
// identifiers and comments (a column defaulted to the string 'check (x)'
// must not match), and the clause is the balanced-paren group that follows.
// The captured label is normalized token-aware: quoted sections are copied
// VERBATIM (whitespace inside a string literal is semantic), comments are
// dropped but act as token separators (which is what they are to SQLite),
// and runs of outside whitespace collapse to one space. Fails closed on
// unterminated constructs, like the DDL classifier does.
const extractCheckClauses = (sql) => {
  const clauses = []
  const n = sql.length
  let i = 0

  // Consume a quoted section starting at i; returns its verbatim text.
  const scanQuoted = (close) => {
    const start = i
    let text = sql[i]
    i++
    while (i < n) {
      if (sql[i] === close) {
        // Doubled close-quote is an escape everywhere SQLite quotes.
        if (sql[i + 1] === close) {
          text += sql[i] + sql[i + 1]
          i += 2
          continue
        }
        text += sql[i]
        i++
        return text
      }
      text += sql[i]
      i++
    }
    throw new Error(`unterminated ${close}-quoted section at ${start}`)
  }
  const scanBracket = () => {
    const end = sql.indexOf(']', i + 1)
    if (end === -1) throw new Error(`unterminated [identifier] at ${i}`)
    const text = sql.slice(i, end + 1)
    i = end + 1
    return text
  }
  const scanLineComment = () => {
    const end = sql.indexOf('\n', i)
    i = end === -1 ? n : end + 1
  }
  const scanBlockComment = () => {
    const end = sql.indexOf('*/', i + 2)
    if (end === -1) throw new Error(`unterminated block comment at ${i}`)
    i = end + 2
  }

  while (i < n) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      scanQuoted(ch)
      continue
    }
    if (ch === '[') {
      scanBracket()
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      scanLineComment()
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      scanBlockComment()
      continue
    }
    if (isIdentStart(ch)) {
      let j = i
      while (j < n && isIdentChar(sql[j])) j++
      const word = sql.slice(i, j).toLowerCase()
      i = j
      if (word !== 'check') continue
      // Whitespace AND comments may sit between CHECK and its paren.
      for (;;) {
        if (i < n && isSqlSpace(sql[i])) {
          i++
          continue
        }
        if (sql[i] === '-' && sql[i + 1] === '-') {
          scanLineComment()
          continue
        }
        if (sql[i] === '/' && sql[i + 1] === '*') {
          scanBlockComment()
          continue
        }
        break
      }
      if (sql[i] !== '(') continue
      // Balanced capture with the SAME lexical handling as the outer loop -
      // a paren inside a string, comment, or [identifier] must not end or
      // truncate the clause (a truncated label would let a weakened CHECK
      // compare equal to the original).
      const start = i
      const buf = []
      let pendingSpace = false
      const push = (text) => {
        if (
          pendingSpace &&
          buf.length > 0 &&
          text !== ')' &&
          buf[buf.length - 1] !== '('
        ) {
          buf.push(' ')
        }
        pendingSpace = false
        buf.push(text)
      }
      let depth = 0
      while (i < n) {
        const c = sql[i]
        if (c === "'" || c === '"' || c === '`') {
          push(scanQuoted(c))
          continue
        }
        if (c === '[') {
          push(scanBracket())
          continue
        }
        if (c === '-' && sql[i + 1] === '-') {
          scanLineComment()
          pendingSpace = true
          continue
        }
        if (c === '/' && sql[i + 1] === '*') {
          scanBlockComment()
          pendingSpace = true
          continue
        }
        if (isSqlSpace(c)) {
          pendingSpace = true
          i++
          continue
        }
        if (c === '(') {
          depth++
          push(c)
          i++
          continue
        }
        if (c === ')') {
          depth--
          push(c)
          i++
          if (depth === 0) {
            clauses.push(buf.join(''))
            break
          }
          continue
        }
        push(c)
        i++
      }
      if (depth !== 0) throw new Error(`unterminated CHECK clause at ${start}`)
      continue
    }
    i++
  }
  return clauses
}

// table -> sorted constraint labels (FKs and CHECKs together).
//
// Known scope limit, on purpose: pragma_foreign_key_list cannot see
// DEFERRABLE INITIALLY DEFERRED (enforcement timing) or MATCH clauses
// (SQLite treats every MATCH as NONE anyway). No table in this schema uses
// either; a migration introducing one would be additive and pass, and its
// deferrability would simply be outside this comparison. Extracting it
// would mean parsing FK syntax out of raw DDL - not worth it for a clause
// the schema has never used.
// Tables that would take rows with them if dropped: anything with an incoming
// ON DELETE CASCADE. Read from the live schema, never from a declaration.
//
// This replaces a `hasCascadingChildren: false` boolean the author wrote by
// hand. That was an assertion dressed as a check - it let a contract declare
// any cascade parent childless, and because a declared table is exempted from
// the row and constraint comparisons, dropping a parent AND its children could
// have passed. That is the 0009 wipe with paperwork.
const CASCADE_PARENTS_SQL =
  'select f."table" as ref, f.on_delete as onDelete from sqlite_master m ' +
  `join pragma_foreign_key_list(m.name) f where ${appTablesFilter('m')}`
const parseCascadeParents = (rows) => {
  const parents = new Set()
  for (const row of rows) {
    if (String(row.onDelete || '').toUpperCase() === 'CASCADE') {
      parents.add(String(row.ref).toLowerCase())
    }
  }
  return parents
}


const FOREIGN_KEYS_SQL =
  'select m.name as tbl, f.id as fkid, f.seq as seq, f."table" as ref, ' +
  'f."from" as fromCol, f."to" as toCol, f.on_update as onUpdate, ' +
  'f.on_delete as onDelete from sqlite_master m ' +
  `join pragma_foreign_key_list(m.name) f where ${appTablesFilter('m')}`
const TABLE_SQL_SQL = `select m.name as tbl, m.sql as sql from sqlite_master m where ${appTablesFilter('m')}`

const parseConstraints = (fkRows, tableRows) => {
  const byTable = groupForeignKeyRows(fkRows)
  for (const { tbl, sql } of tableRows) {
    const checks = extractCheckClauses(String(sql)).map((c) => `check ${c}`)
    if (checks.length === 0) continue
    if (!byTable.has(tbl)) byTable.set(tbl, [])
    byTable.get(tbl).push(...checks)
  }
  for (const labels of byTable.values()) labels.sort()
  return byTable
}


// The whole schema-shaped picture of one database state, in ONE launch. Split
// into statements and parsers above so this can exist: every entry describes
// the same moment, which is what makes comparing a before against an after
// meaningful.
const SCHEMA_STATE_READS = [
  { key: 'tables', sql: [TABLES_SQL], parse: ([rows]) => parseTables(rows) },
  { key: 'schemaObjects', sql: [SCHEMA_OBJECTS_SQL], parse: ([rows]) => parseSchemaObjects(rows) },
  { key: 'columnTypes', sql: [COLUMN_TYPES_SQL], parse: ([rows]) => parseColumnTypes(rows) },
  {
    key: 'constraints',
    sql: [FOREIGN_KEYS_SQL, TABLE_SQL_SQL],
    parse: ([fkRows, tableRows]) => parseConstraints(fkRows, tableRows),
  },
  { key: 'cascadeParents', sql: [CASCADE_PARENTS_SQL], parse: ([rows]) => parseCascadeParents(rows) },
]

const schemaStateStatements = () => SCHEMA_STATE_READS.flatMap((read) => read.sql)

const parseSchemaState = (sets) => {
  const wanted = schemaStateStatements().length
  if (sets.length !== wanted) {
    throw new Error(
      `Schema-state batch returned ${sets.length} result sets, expected ${wanted}.`,
    )
  }
  const state = {}
  let at = 0
  for (const read of SCHEMA_STATE_READS) {
    state[read.key] = read.parse(sets.slice(at, at + read.sql.length))
    at += read.sql.length
  }
  return state
}

// Pure comparison: every constraint present before must survive, except on
// tables a GRANDFATHERED migration declared dropped (new migrations cannot
// drop tables at all). Additions are fine - the cap triggers prove additive
// constraints are normal life. No other exemption exists on purpose.
const diffConstraints = (beforeByTable, afterByTable, skipTables) => {
  const failures = []
  for (const [table, labels] of beforeByTable) {
    if (skipTables.has(table)) continue
    const after = new Set(afterByTable.get(table) ?? [])
    for (const label of labels) {
      if (!after.has(label)) {
        failures.push(
          `${table}: constraint dropped or weakened: ${label}. Post-baseline ` +
            'migrations may never remove a CHECK or FOREIGN KEY - the ' +
            'same-owner FKs are the authorization backstop. If this appears, ' +
            'a rebuild got past the destructive-DDL gate; fix the migration, ' +
            'do not add an exemption.',
        )
      }
    }
  }
  return failures
}

// Drops fixture columns the schema does not have yet, so a fixture can be
// written against the post-migration schema.
//
// `alreadyApplied(migration)` decides which side of each EXPECTED_CHANGES entry
// to seed, and it has to be an ORDERING question rather than a set-membership
// one. Seeding `after` for anything simply "not under test" was wrong: with
// 0021 declaring A -> B and 0022 declaring B -> C, 0021's pass would seed C -
// the state two migrations in the future - and 0021 would then be tested against
// data that never existed at the point it runs. A later declaration could
// retroactively hide corruption in an earlier migration's test.
//
// The rule is simply the truth about the database at this point: a change seeds
// `after` if its migration has ALREADY run, and `before` if it has not - which
// covers both the migration under test and every migration after it.
const seed = (columnsByTable, alreadyApplied, underTest) => {
  const seededColumns = new Map()
  const inserts = []

  for (const [table, fixtureRow] of FIXTURES) {
    const existing = columnsByTable.get(table)
    if (!existing) continue // table arrives in a later migration
    // A migration that refuses a populated table is tested against the
    // state it demands. Every OTHER pass still seeds this table, so a later
    // rebuild of it is caught as usual.
    if (REQUIRE_EMPTY_TABLE.some((r) => r.migration === underTest && r.table === table)) continue

    const row = { ...fixtureRow }

    // Resolved per COLUMN and in MIGRATION order. Assigning each matching change
    // in turn was still wrong, just less obviously: with 0021 declaring A -> B
    // and 0022 declaring B -> C, 0021's pass assigned A (0021 not yet applied)
    // and then immediately overwrote it with B (0022 not yet applied either).
    // The seeded value depended on which order the entries happened to be
    // written in, and B is exactly the state that makes a no-op 0021 look
    // correct - its before and its expected after would both be B.
    const changesByColumn = new Map()
    for (const change of EXPECTED_CHANGES) {
      if (change.table !== table) continue
      if (row[change.key.column] !== change.key.value) continue
      if (!changesByColumn.has(change.column)) changesByColumn.set(change.column, [])
      changesByColumn.get(change.column).push(change)
    }
    for (const [column, changes] of changesByColumn) {
      row[column] = resolveExpectedValue(changes, alreadyApplied)
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

// Re-render SQLite's JSON through JS so a column's STORAGE CLASS cannot
// masquerade as a changed value. SQLite prints the same number differently
// depending on the column's declared type - an integer 1200 renders as `1200`,
// the identical value in a REAL column as `1200.0` - so a migration that only
// widens integer -> real would trip the row-changed check while altering no
// data. Parsing to a JS number and re-stringifying collapses that difference.
//
// This normalizes NUMBER FORMATTING only. A genuine value change (1200 -> 1201)
// still differs, and so does a type change across the string/number boundary
// ('1200' stays quoted). Assumes every numeric column fits in a JS safe
// integer, which holds here: ids and slugs are text, epoch-ms timestamps and
// cost_cents are both far below 2^53. An int64 column beyond that range would
// need a different comparison.
//
// It DOES make this comparison blind to an integer -> real widening on any
// column, not just an intended one. EXPECTED_TYPE_CHANGES plus the declared-
// type check in main() is what covers that; neither is sufficient alone.
const canonicalize = (json) => JSON.stringify(JSON.parse(json))

// Every seeded row, as JSON, keyed by table. Reads only the columns that
// existed before the migration: new columns are expected to differ, old ones
// are not allowed to.
const snapshotStatements = (seededColumns) =>
  [...seededColumns.keys()].map((table) => {
    const pairs = seededColumns
      .get(table)
      .map((col) => `'${col}', ${quoteIdent(col)}`)
      .join(', ')
    return `select json_object(${pairs}) as row from ${quoteIdent(table)}`
  })

// Positional, over the same Map insertion order snapshotStatements walks.
const parseSnapshot = (seededColumns, sets) =>
  new Map(
    [...seededColumns.keys()].map((table, i) => [
      table,
      // Sorted so the comparison does not depend on row order.
      sets[i].map(({ row }) => canonicalize(row)).sort(),
    ]),
  )


// Tests ONE migration, against a database holding every migration before it -
// applied AND seeded with fixture rows.
//
// Running the whole post-baseline set in a single pass was wrong, and silently
// so. Seeding happens once, at the start. A table created by 0021 therefore held
// no rows when 0022 ran, so `DELETE FROM that_table` in 0022 compared empty
// against empty and passed. The blind spot grew with every migration added.
// One pass per migration means each one faces populated tables, which is the
// whole point of the check.
const checkOneMigration = (postBaseline, index) => {
  const name = postBaseline[index]
  // Everything production would have applied before this migration: the whole
  // frozen baseline plus the post-baseline files sorting ahead of it.
  const priorNames = [
    ...[...PRE_GATE_MIGRATIONS.keys()].sort(),
    ...postBaseline.slice(0, index),
  ]
  const addedNames = new Set([name])

  // "Has this migration run by the time the one under test starts?" Anything in
  // the frozen baseline has. Anything post-baseline has only if it sorts before
  // this one. The migration under test itself has NOT - it is applied after
  // seeding, which is the entire point.
  const appliedBefore = new Set(postBaseline.slice(0, index))
  const alreadyApplied = (migration) =>
    !postBaseline.includes(migration) || appliedBefore.has(migration)

  // Transient tables only exist once the migration that creates them has run.
  // Asserting all of them in every pass would fail an earlier migration's pass
  // for a table a later migration has not created yet.
  // A transient table a contract step has already removed is no longer expected
  // to exist. Without this the entry reads as stale the moment the drop lands,
  // which is the opposite of what it means.
  // A contract-dropped table needs THREE different answers depending on when
  // you ask, and collapsing them into one set is how this went wrong twice.
  //
  //   droppedAlready  - the drop ran in an EARLIER migration than this pass.
  //                     The table is simply gone; it is neither exempt from
  //                     needing a fixture nor expected to exist.
  //   droppedHere     - the drop is THIS migration. The table still exists at
  //                     seed time, so it keeps its fixture exemption, but it
  //                     must not be asserted to survive.
  const droppedAlready = new Set()
  const droppedHere = new Set()
  for (const [migration, contract] of CONTRACT_MIGRATIONS) {
    const tables = contract.objects.filter((o) => o.kind === 'table').map((o) => o.name)
    if (migration === name) tables.forEach((t) => droppedHere.add(t))
    else if (alreadyApplied(migration)) tables.forEach((t) => droppedAlready.add(t))
  }

  // Exempt from the new-table fixture demand: transients that EXIST at seed
  // time. A transient whose contract drop already ran is deliberately NOT in
  // here - if some later migration recreates that name, it is a new table and
  // must earn a fixture like any other.
  const transientsCreated = TRANSIENT_TABLES.filter(
    (t) =>
      (alreadyApplied(t.migration) || t.migration === name) &&
      !droppedAlready.has(t.table),
  )

  // Asserted to exist and be empty AFTER the migration - so the one this
  // migration drops comes out too.
  const transientsInPlay = transientsCreated.filter((t) => !droppedHere.has(t.table))

  console.log(`\n--- ${name}`)
  persistDir = mkdtempSync(join(tmpdir(), 'migration-safety-'))

  try {
    // 1. Rewind to just before this migration by STAGING only what came before
    // it. Nothing is removed from the tracked tree - the API suite migrates
    // from that same directory (vitest.workers.config.ts), and a concurrent run
    // used to see a truncated set.
    const stagedDir = stageMigrationsDir(persistDir, priorNames)
    configPath = writeWranglerConfig(persistDir, stagedDir)

    console.log('  applying everything before it...')
    applyMigrations()

    // The staged directory is only worth anything if wrangler actually read it.
    // Asserted against the CONFIGURED ledger table, not a hard-coded name: a
    // check reading `d1_migrations` while wrangler wrote elsewhere would find an
    // empty table and pass.
    // BATCH A. One launch for two reads of the same state: prove wrangler
    // applied exactly what was staged, and read the column sets seed() needs.
    // Nothing mutates between the apply above and the seed below, so they
    // describe the same database.
    const [ledgerRows, columnRows] = batchReadSql([
      `select name from ${quoteIdent(migrationsTableName())} order by id`,
      COLUMNS_SQL,
    ])
    const ledger = ledgerRows.map((row) => row.name)
    if (JSON.stringify(ledger) !== JSON.stringify(priorNames)) {
      throw new Error(
        `The staged directory is not what wrangler applied.\n` +
          `  staged:  ${priorNames.join(', ')}\n` +
          `  applied: ${ledger.join(', ')}\n` +
          "The generated config's migrations_dir or migrations_table is not " +
          'being honored.',
      )
    }

    // 2. Make the database look like production.
    const columnsByTable = parseColumns(columnRows)
    if (columnsByTable.size === 0) {
      console.log('  no tables exist yet; there is no data to preserve.')
      return
    }

    const seededColumns = seed(columnsByTable, alreadyApplied, name)

    // BATCH B. Everything that describes the database this migration is about
    // to run against - the seeded rows AND the schema they live in - in one
    // launch. Snapshot statements first, schema-state statements after; the
    // split is positional.
    const beforeSnapshotSql = snapshotStatements(seededColumns)
    const beforeSets = batchReadSql([...beforeSnapshotSql, ...schemaStateStatements()])
    const before = parseSnapshot(seededColumns, beforeSets.slice(0, beforeSnapshotSql.length))
    const {
      tables: tablesBefore,
      schemaObjects: schemaBefore,
      columnTypes: typesBefore,
      constraints: constraintsBefore,
      cascadeParents,
    } = parseSchemaState(beforeSets.slice(beforeSnapshotSql.length))

    // Transient tables are exempt here for the same reason they are exempt
    // from the new-table fixture check below: a seeded row asserts a state that
    // can never persist. This matters MORE once they are in the baseline -
    // every future migration would otherwise trip this, which is exactly the
    // shape of breakage 0018 left behind by relying on its own backfill.
    // Derived from transientsCreated, not from the raw list - and NOT from
    // transientsInPlay, which additionally excludes the table this very
    // migration drops, and that one still exists at seed time. A transient
    // whose contract drop ran EARLIER is no longer exempt: if a later migration
    // recreates that name, it must earn a fixture like any other new table.
    // Reading the raw list here would exempt the name permanently, leaving the
    // recreated table invisible to every preservation check thereafter.
    const transientAtBase = new Set(transientsCreated.map((t) => t.table))
    // A REQUIRE_EMPTY_TABLE entry exempts its table from seeding ONLY in the
    // pass for the migration that needs it empty; the fixture itself must
    // still exist, or the table would be invisible to every other pass.
    const requiredEmpty = new Set(
      REQUIRE_EMPTY_TABLE.filter((r) => r.migration === name).map((r) => r.table),
    )
    for (const table of requiredEmpty) {
      if (!FIXTURES.some(([fixtureTable]) => fixtureTable === table)) {
        throw new Error(
          `REQUIRE_EMPTY_TABLE names ${table} for ${name}, but ${table} has no ` +
            'fixture row. The exemption is for one pass, not a way to skip the ' +
            'fixture: add one so every other pass still checks the table.',
        )
      }
    }
    const unseeded = tablesBefore.filter(
      (table) =>
        !seededColumns.has(table) && !transientAtBase.has(table) && !requiredEmpty.has(table),
    )
    if (unseeded.length > 0) {
      throw new Error(
        `No fixture for: ${unseeded.join(', ')}.\n` +
          'Every table needs a fixture row in scripts/check-migration-safety.mjs, ' +
          'or this check would silently skip it. Add one.',
      )
    }

    // A contract step may only drop a table nothing cascades FROM, and the
    // proof is the live schema immediately before the drop - not a boolean in
    // the declaration. Checked here rather than in the gate because that runs
    // without a database, and the honest answer needs one.
    // cascadeParents comes from batch B above: it describes the same live
    // schema this check used to read in a launch of its own, and is still
    // consulted only for a contract migration.
    const contract = CONTRACT_MIGRATIONS.get(name)
    if (contract) {
      for (const object of contract.objects) {
        if (object.kind !== 'table') continue
        if (cascadeParents.has(object.name.toLowerCase())) {
          throw new Error(
            `${name} declares a drop of ${object.name}, but another table ` +
              'references it with ON DELETE CASCADE. DROP TABLE performs an ' +
              'implicit DELETE that fires those cascades - that is exactly how ' +
              '0009 wiped list_items - so a cascade parent may never be ' +
              'dropped, declaration or not.',
          )
        }
      }
    }
    const seededRows = [...before.values()].reduce((n, rows) => n + rows.length, 0)
    console.log(`  seeded ${seededRows} rows across ${before.size} tables.`)

    // 3. Apply THIS migration alone, exactly as deploy.yml does in production.
    copyFileSync(join(MIGRATIONS_DIR, name), join(stagedDir, name))

    console.log(`  applying ${name}...`)
    applyMigrations()

    // 4. Nothing may have been lost or corrupted - except the rewrites the
    // new migrations DECLARED, which must have happened exactly as declared.
    // A table dropped by a grandfathered migration is read neither here nor
    // below: it no longer exists, and every OTHER table's rows still get
    // compared, which is what proves the drop did not cascade into surviving
    // data. New migrations cannot reach this path - the gate rejects them.
    const droppedTables = new Set(
      DROPPED_TABLES.filter((d) => addedNames.has(d.migration)).map((d) => d.table),
    )
    // Same two-source rule as columns below: a table a contract step removes is
    // expected to be gone, and the "did the drop actually run" assertion below
    // then covers it for free.
    for (const [migration, contract] of CONTRACT_MIGRATIONS) {
      if (!addedNames.has(migration)) continue
      for (const object of contract.objects) {
        if (object.kind === 'table') droppedTables.add(object.name)
      }
    }
    // Declared-dropped columns come out of the compared column set. Quoting a
    // column SQLite no longer has would silently read back as the column NAME
    // (its double-quoted-string fallback), which reads as a corrupted value
    // rather than an absent one.
    //
    // Two sources feed this, and they are different KINDS of thing: the frozen
    // DROPPED_COLUMNS list describes grandfathered baseline migrations, while
    // CONTRACT_MIGRATIONS describes removals the gate deliberately permits from
    // here on. Both mean the same thing to the comparison - do not expect this
    // column afterwards - so they share one exclusion set rather than two
    // mechanisms that could disagree.
    const droppedColumns = new Map()
    const excludeColumn = (table, column) => {
      if (!droppedColumns.has(table)) droppedColumns.set(table, new Set())
      droppedColumns.get(table).add(column)
    }
    for (const d of DROPPED_COLUMNS) {
      if (!addedNames.has(d.migration)) continue
      excludeColumn(d.table, d.column)
    }
    for (const [migration, contract] of CONTRACT_MIGRATIONS) {
      if (!addedNames.has(migration)) continue
      for (const object of contract.objects) {
        if (object.kind === 'column') excludeColumn(object.table, object.name)
      }
    }
    const survivingColumns = new Map(
      [...seededColumns]
        .filter(([table]) => !droppedTables.has(table))
        .map(([table, cols]) => [
          table,
          cols.filter((col) => !droppedColumns.get(table)?.has(col)),
        ]),
    )
    // BATCH C. The whole post-migration picture in one launch: the surviving
    // rows and the schema they now live in. survivingColumns is derived from
    // the declarations and seededColumns above, never from a query, so it is
    // available before this batch runs.
    const afterSnapshotSql = snapshotStatements(survivingColumns)
    const afterSets = batchReadSql([...afterSnapshotSql, ...schemaStateStatements()])
    const after = parseSnapshot(survivingColumns, afterSets.slice(0, afterSnapshotSql.length))
    const {
      tables: tablesStillPresent,
      schemaObjects: schemaObjectsAfter,
      columnTypes: typesAfter,
      constraints: constraintsAfter,
    } = parseSchemaState(afterSets.slice(afterSnapshotSql.length))
    const stillPresent = new Set(tablesStillPresent)
    // A declared table drop has to be an EVENT, not an intention.
    // `DROP TABLE IF EXISTS never_existed` removes nothing and would otherwise
    // satisfy its own declaration - the same gap the trigger/index check just
    // closed. tablesBefore is captured above, before the migration ran.
    if (contract) {
      const wasPresent = new Set(tablesBefore)
      const neverExisted = contract.objects
        .filter((o) => o.kind === 'table')
        .map((o) => o.name)
        .filter((name) => !wasPresent.has(name))
      if (neverExisted.length > 0) {
        throw new Error(
          `${name} declares it drops ${neverExisted.join(', ')}, but the table ` +
            'did not exist before this migration ran. The declaration ' +
            'describes something that never happened.',
        )
      }
    }
    const notActuallyDropped = [...droppedTables].filter((t) => stillPresent.has(t))
    if (notActuallyDropped.length > 0) {
      throw new Error(
        `DROPPED_TABLES names ${notActuallyDropped.join(', ')}, but the ` +
          'migration left them in place. Either the drop did not run or the ' +
          'declaration is stale.',
      )
    }

    const failures = []
    const expected = new Map(
      [...applyExpectedChanges(before, addedNames)].map(([table, rows]) => {
        const gone = droppedColumns.get(table)
        if (!gone) return [table, rows]
        return [
          table,
          rows
            .map((json) => {
              const row = JSON.parse(json)
              for (const col of gone) delete row[col]
              return JSON.stringify(row)
            })
            .sort(),
        ]
      }),
    )

    for (const [table, beforeRows] of expected) {
      if (droppedTables.has(table)) continue
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

    // Column types that changed without being declared. canonicalize() makes
    // the value comparison blind to integer -> real, so this is what stops an
    // unintended widening (e.g. rebuilding cost_cents as REAL, which would let
    // fractional cents in later).
    const allowedTypeChanges = new Map(
      EXPECTED_TYPE_CHANGES.filter((c) => addedNames.has(c.migration)).map((c) => [
        c.column,
        c,
      ]),
    )
    for (const [column, beforeType] of typesBefore) {
      const afterType = typesAfter.get(column)
      if (afterType === undefined || afterType === beforeType) continue
      const allowed = allowedTypeChanges.get(column)
      if (allowed && allowed.from === beforeType && allowed.to === afterType) {
        allowedTypeChanges.delete(column)
        continue
      }
      failures.push(
        `${column}: declared type changed ${beforeType} -> ${afterType} without being ` +
          'declared in EXPECTED_TYPE_CHANGES. A rebuild that widens a column is ' +
          'silent - the value comparison cannot see it.',
      )
    }
    // A declared change that never happened is also a failure: it means the
    // migration did not do what its entry here claims.
    for (const [column, change] of allowedTypeChanges) {
      failures.push(
        `${column}: EXPECTED_TYPE_CHANGES declares ${change.from} -> ${change.to}, ` +
          `but the type is ${typesAfter.get(column) ?? 'absent'}.`,
      )
    }

    // Triggers and indexes that a rebuild dropped and never put back. Objects
    // belonging to a declared-dropped TABLE went with it; objects on surviving
    // tables must be declared one by one.
    const schemaAfter = new Set(schemaObjectsAfter.map((o) => o.label))
    const allowedGone = new Set(
      DROPPED_SCHEMA_OBJECTS.filter((d) => addedNames.has(d.migration)).map((d) => d.object),
    )
    // Same two-source rule as the column and table exclusions: a trigger or
    // index a contract step removes is expected to be gone. The label shape
    // here is "trigger <name>" / "index <name>", matching listSchemaObjects().
    for (const [migration, contract] of CONTRACT_MIGRATIONS) {
      if (!addedNames.has(migration)) continue
      for (const object of contract.objects) {
        if (object.kind === 'trigger' || object.kind === 'index') {
          allowedGone.add(`${object.kind} ${object.name}`)
        }
      }
    }
    // A declared trigger or index must actually be absent afterwards, the same
    // way DROPPED_TABLES proves its tables went. Without this, `DROP TRIGGER IF
    // EXISTS temp.foo` satisfied a declaration naming `foo` while the real
    // main.foo survived - the declaration exempted it from the survival check
    // below, and nothing else looked.
    if (contract) {
      const stillThere = new Set(schemaAfter)
      const wasThere = new Set(schemaBefore.map((o) => o.label))
      const declaredObjects = contract.objects.filter(
        (o) => o.kind === 'trigger' || o.kind === 'index',
      )
      const survivors = declaredObjects
        .map((o) => `${o.kind} ${o.name}`)
        .filter((label) => stillThere.has(label))
      if (survivors.length > 0) {
        failures.push(
          `Declared removed but still present: ${survivors.join(', ')}. The ` +
            'declaration exempts these from the survival check, so a drop that ' +
            'silently matched nothing would otherwise look like a success.',
        )
      }
      // ...and it has to have been there to begin with. `DROP TRIGGER IF
      // EXISTS missing` removes nothing and would otherwise satisfy its own
      // declaration, which makes the declaration a description of an intention
      // rather than of an event.
      const neverExisted = declaredObjects
        .map((o) => `${o.kind} ${o.name}`)
        .filter((label) => !wasThere.has(label))
      if (neverExisted.length > 0) {
        failures.push(
          `Declared removed but never existed: ${neverExisted.join(', ')}. ` +
            'The declaration says this migration removes it; the database says ' +
            'there was nothing there. One of the two is wrong.',
        )
      }
    }

    const dropped = schemaBefore
      .filter((object) => !droppedTables.has(object.table))
      .filter((object) => !allowedGone.has(object.label))
      .map((object) => object.label)
      .filter((label) => !schemaAfter.has(label))
    if (dropped.length > 0) {
      failures.push(
        `Dropped and never recreated: ${dropped.join(', ')}. ` +
          'A table rebuild drops the table\'s triggers and indexes; hand-written ' +
          'ones are not in the drizzle snapshot, so the migration must recreate ' +
          'them explicitly.',
      )
    }

    // CHECK and FOREIGN KEY constraints that vanished. Unconditional for
    // post-baseline migrations - see diffConstraints for why there is no
    // declaration hatch.
    failures.push(
      ...diffConstraints(constraintsBefore, constraintsAfter, droppedTables),
    )

    // Probes belonging to the migration under test. Run AFTER the snapshots so
    // a probe that unexpectedly succeeds cannot contaminate the row comparison
    // above.
    for (const check of POST_CHECKS) {
      if (!addedNames.has(check.migration)) continue
      const problem = check.expectErrorMatch
        ? expectSqlError(check.sql, check.expectErrorMatch)
        : expectSqlRows(check.sql, check.expectRows)
      if (problem) {
        failures.push(`Post-check "${check.description}" ${problem}`)
      }
    }

    // BATCH D. What exists once the probes have run - and it is read ALONE,
    // before anything names a table it has not confirmed. 15 of the 24 probes
    // write, so this cannot join batch C.
    const [tablesAfterRows] = batchReadSql([TABLES_SQL])
    const tablesAfter = parseTables(tablesAfterRows)
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
    // Same derivation as transientAtBase above, and for the same reason: a
    // dropped transient's NAME must not carry its exemption forward.
    const transientTables = new Set(transientsCreated.map((t) => t.table))
    const fixtureTables = new Set(FIXTURES.map(([table]) => table))
    const missingFixture = tablesAfter.filter(
      (table) =>
        !isScratchTable(table) &&
        !fixtureTables.has(table) &&
        !transientTables.has(table),
    )
    if (missingFixture.length > 0) {
      failures.push(
        `New table(s) with no fixture: ${missingFixture.join(', ')}. ` +
          'Add a fixture row to scripts/check-migration-safety.mjs, or no future ' +
          'migration will ever be checked against them.',
      )
    }

    // BATCH E. A transient table earns its fixture exemption by proving the
    // thing that makes it transient: it exists, and it is empty.
    //
    // Counted in a batch of its own, over only the tables batch D confirmed
    // present. `select count(*) from _missing_table` fails, and a failing
    // statement takes its whole batch down with no result sets - so counting
    // inside batch D would have destroyed tablesAfter whenever a declared
    // transient was absent, and that case has its own verdict below.
    const presentTransients = transientsInPlay.filter((t) => tablesAfter.includes(t.table))
    const transientCountSets = batchReadSql(
      presentTransients.map((t) => `select count(*) as n from ${quoteIdent(t.table)}`),
    )
    const transientCounts = new Map(
      presentTransients.map((t, i) => [t.table, Number(transientCountSets[i]?.[0]?.n ?? -1)]),
    )

    for (const { table, why } of transientsInPlay) {
      if (!tablesAfter.includes(table)) {
        failures.push(
          `Declared transient table ${table} does not exist after migration. ` +
            'Either the migration that creates it is missing, or the ' +
            'TRANSIENT_TABLES entry is stale.',
        )
        continue
      }
      const n = transientCounts.get(table) ?? -1
      if (n !== 0) {
        failures.push(
          `Transient table ${table} holds ${n} row(s) after migration; it must ` +
            `be empty (${why}).`,
        )
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `${name} is NOT safe to apply to production:\n\n` +
          failures.map((f) => `  - ${f}`).join('\n') +
          '\n\nThis is how a table rebuild destroys cascading child rows on D1, ' +
          'where PRAGMA foreign_keys=OFF is a no-op - see AGENTS.md. Note that ' +
          'new migrations cannot rebuild a table at all while the ' +
          'destructive-DDL gate stands, so reaching this failure means either a ' +
          'grandfathered migration is under test or the gate was edited.',
      )
    }

    console.log(`  OK: all ${seededRows} seeded rows survived ${name}.`)
  } finally {
    // Nothing to put back: this pass only ever read the tracked tree.
    rmSync(persistDir, { recursive: true, force: true })
  }
}

const main = () => {
  // All three run before anything else and none of them consults git, so none
  // can be skipped by a branch that happens to touch no SQL: prove the
  // classifier still works, prove the baseline is still the baseline, then hold
  // every post-baseline migration to the gate.
  selfTestDdlGate()
  selfTestExpectedValues()
  selfTestConstraintCompare()
  selfTestConfigRebase()
  selfTestMarkedBatch()
  selfTestBatchAttribution()
  verifyMigrationsDirIsPinned()
  verifySnapshotChainIntact()
  verifySnapshotMatchesSchema()
  validateExpectedChanges(
    new Set([...PRE_GATE_MIGRATIONS.keys(), ...postBaselineMigrations()]),
  )
  verifyBaselineIntact()
  gateNewMigrations()

  // EVERY post-baseline migration, not just the ones this push happened to
  // touch. The diff-scoped version had a wash-through: push A adds a migration
  // that corrupts rows, this check goes red and A never deploys; push B changes
  // no SQL, so the diff is empty, this check reports "nothing to do", B is
  // green - and B's deploy runs `wrangler d1 migrations apply`, which applies
  // every PENDING migration, A's included. Anchoring to the frozen baseline
  // instead means A's migration is re-tested on every run until it is fixed.
  const postBaseline = postBaselineMigrations()

  if (postBaseline.length === 0) {
    console.log('No migrations added since the frozen baseline. Nothing to check.')
    return
  }

  console.log('Migrations added since the frozen baseline:')
  for (const name of postBaseline) console.log(`  ${name}`)

  // This script only ever READS the tracked tree, and that is checked rather
  // than trusted: a pass that wrote to it would corrupt every other check
  // silently, and the API suite migrates from the same directory.
  const treeBefore = trackedTreeDigest()

  // Checked on EVERY path, not just the happy one. The restoration this
  // replaced lived in a `finally`, so a pass that threw still put the tree
  // back; a guard that only runs after all seven passes succeed would go quiet
  // in exactly the case where a stray write is most likely.
  let passError = null
  try {
    for (let i = 0; i < postBaseline.length; i += 1) {
      checkOneMigration(postBaseline, i)
    }
  } catch (error) {
    passError = error
  }

  if (trackedTreeDigest() !== treeBefore) {
    const message =
      `This script modified the tracked ${MIGRATIONS_DIR} tree. It must only ` +
      'ever read it - the API suite migrates from the same directory ' +
      '(vitest.workers.config.ts), and an edited or truncated tree silently ' +
      'changes what every other check tests against. The digest cannot say ' +
      `which file moved; run \`git status ${MIGRATIONS_DIR}/\` to see.`
    // A corrupted tree is the more urgent of the two, and it explains the
    // other: a pass reading a mutated directory can fail for that reason. The
    // original failure is carried along rather than swallowed.
    throw passError
      ? new Error(`${message}\n\nThe run also failed:\n${passError.message}`)
      : new Error(message)
  }
  if (passError) throw passError

  console.log(
    `\nOK: ${postBaseline.length} post-baseline migration(s) each preserve ` +
      'the data that existed before them.',
  )
}

try {
  main()
} catch (error) {
  console.error(`\n${error.message}`)
  process.exit(1)
}
