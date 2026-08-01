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
// Writing a migration that DELIBERATELY DROPS a column? Declare it in
// DROPPED_COLUMNS, and any index or trigger that went with it in
// DROPPED_SCHEMA_OBJECTS. Every OTHER column on that table is still compared
// value-for-value, so the rebuild that removed it still has to preserve the
// rest of the row.
//
// Writing a migration that DELIBERATELY DROPS a table? Declare it in
// DROPPED_TABLES. Its fixture stays - the table has to hold rows for the drop
// to be realistic, and a cascade from it into a surviving table is exactly the
// kind of damage this script exists to catch - but the table itself is exempt
// from the after-comparison, which would otherwise fail trying to read a table
// that is supposed to be gone.
//
// Changing a column's declared TYPE? Declare it in EXPECTED_TYPE_CHANGES. Value
// comparison ignores numeric formatting (1200 vs 1200.0), so the declared type
// is the only thing standing between you and an accidental widening.
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

// NOTE on pack_sort_order: these values are explicit, and must stay that way.
// They were originally omitted so that 0018's backfill would assign them, which
// is what the 0018 POST_CHECKS probe asserts. That worked only while 0018 was
// the migration UNDER TEST. Now that 0018 is on the base ref, the fixtures are
// seeded into a schema that already carries its two unique indexes, so rows
// defaulting to 0 in the same cohort collide - and the seed fails before any
// new migration is even applied. The values below are exactly what the 0018
// backfill produced, so that probe still asserts the same thing.
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
  // Food estimate (0017). Slots are the trip's eating periods; items are what
  // you CARRY; the association expresses intent only and is never summed.
  //
  // One item is associated with a needed slot; a SECOND slot is pruned and
  // deliberately holds nothing, because "pruned but still holding food" is a
  // state the schema forbids (see the needed_only trigger). What this
  // actually guards is a future migration DELETING or REWRITING association
  // rows, or resetting `needed` back to 1 during a rebuild - either of which
  // would silently re-add meals the user said they were not eating. It does
  // NOT catch a future migration adding a weight column to the association
  // table: the guard deliberately excludes new columns from comparison, so a
  // wrong sum introduced that way has to be caught by tests, not here.
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
    // A deliberately pruned slot: "not needed" must survive a migration, or a
    // rebuild would silently re-add meals the user said they were not eating.
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
  // Nutrition targets (migration 0012). One row per table; the daily row is a
  // range (both bounds live), the meal row a max-mode pct metric (exercises
  // the pct ceiling's happy side), the default a min - so a rebuild that
  // mangles any bounds branch trips at least one row.
  ['food_plan_daily_targets', {
    id: 'daily-target-seed',
    user_id: 'u-seed',
    food_plan_id: 'plan-seed',
    metric: 'calories',
    mode: 'range',
    target_min: 2500,
    target_max: 3500,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['meal_targets', {
    id: 'meal-target-seed',
    user_id: 'u-seed',
    food_plan_id: 'plan-seed',
    meal_id: 'meal-seed',
    metric: 'fat_pct',
    mode: 'max',
    target_min: null,
    target_max: 35,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  }],
  ['food_plan_target_defaults', {
    id: 'default-target-seed',
    user_id: 'u-seed',
    metric: 'protein',
    mode: 'min',
    target_min: 120,
    target_max: null,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
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

// Tables a migration is ALLOWED to drop. Keyed by the migration that drops
// them, so the exemption applies only while that migration is new on the
// branch; afterwards the table is gone from the base schema and needs no
// fixture at all.
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
]

// Columns a migration is ALLOWED to drop, and the schema objects that go with
// them. Indexes and triggers belonging to a DROPPED_TABLES entry are exempt
// automatically (the table took them); this list is for objects on tables that
// SURVIVE, where a silently vanished index would be a real regression.
const DROPPED_COLUMNS = [
  { migration: '0016_remove-food-planning.sql', table: 'lists', column: 'food_plan_id' },
]

const DROPPED_SCHEMA_OBJECTS = [
  { migration: '0016_remove-food-planning.sql', object: 'index lists_food_plan_id_unique' },
]

// Column type changes a migration is ALLOWED to make. Anything not listed here
// that changes type fails the run. Keep this tight: an unintended rebuild that
// widens a column is exactly the silent corruption this script exists to catch,
// and canonicalize() means the value comparison can no longer see it.
const EXPECTED_TYPE_CHANGES = [
  {
    migration: '0013_gear-weight-real.sql',
    column: 'gear_items.weight_grams',
    from: 'INTEGER',
    to: 'REAL',
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
  {
    migration: '0013_gear-weight-real.sql',
    description: 'gear_items.weight_grams is declared REAL, not integer',
    // SQLite INTEGER affinity already STORES 12.4 as a real, so a
    // write-then-read round trip passes whether or not this migration ran and
    // cannot prove it. The declared type is the only observable difference.
    sql:
      "select upper(type) as type from pragma_table_info('gear_items') " +
      "where name = 'weight_grams'",
    expectRows: [{ type: 'REAL' }],
  },
  // 1. new column exists and is TEXT
  { migration: '0014_packing-locations.sql', description: 'list_items.packing_location_id is TEXT',
    sql: "select upper(type) as type from pragma_table_info('list_items') where name='packing_location_id'",
    expectRows: [{ type: 'TEXT' }] },
  // 2. all four new indexes exist (deterministic order)
  { migration: '0014_packing-locations.sql', description: 'packing-location indexes exist',
    sql: "select name from sqlite_master where type='index' and name in ('list_items_packing_location_idx','packing_locations_id_list_user_unique','packing_locations_id_user_unique','packing_locations_list_sort_idx') order by name",
    expectRows: [ { name: 'list_items_packing_location_idx' }, { name: 'packing_locations_id_list_user_unique' },
                  { name: 'packing_locations_id_user_unique' }, { name: 'packing_locations_list_sort_idx' } ] },
  // 3. INSERT trigger fires on a bogus location (no setup needed)
  { migration: '0014_packing-locations.sql', description: 'insert with unknown location aborts',
    sql: "insert into list_items (id,user_id,list_id,gear_item_id,quantity,is_worn,is_consumable,is_packed,is_ready,sort_order,created_at,updated_at,packing_location_id) values ('li-chk-ins','u-seed','list-seed','gear-seed',1,0,0,0,0,90,0,0,'nonexistent')",
    expectErrorMatch: /does not belong to this list/ },
  // 4. SETUP: create a valid location on list-seed
  { migration: '0014_packing-locations.sql', description: 'setup: valid location',
    sql: "insert into packing_locations (id,user_id,list_id,name,sort_order,created_at,updated_at) values ('pl-chk','u-seed','list-seed','Chk',0,0,0) returning id",
    expectRows: [{ id: 'pl-chk' }] },
  // 5. a legitimate assignment is ALLOWED (trigger must not over-fire)
  { migration: '0014_packing-locations.sql', description: 'setup: valid assignment allowed',
    sql: "insert into list_items (id,user_id,list_id,gear_item_id,quantity,is_worn,is_consumable,is_packed,is_ready,sort_order,created_at,updated_at,packing_location_id) values ('li-chk','u-seed','list-seed','gear-seed',1,0,0,0,0,91,0,0,'pl-chk') returning id",
    expectRows: [{ id: 'li-chk' }] },
  // 6. child list_id-only update fires (the rev-2 hole): pl-chk is on list-seed
  { migration: '0014_packing-locations.sql', description: 'child list_id move aborts while assigned',
    sql: "update list_items set list_id='list-seed-3' where id='li-chk'",
    expectErrorMatch: /does not belong to this list/ },
  // 7. child packing_location_id update to a bogus id fires
  { migration: '0014_packing-locations.sql', description: 'child assignment to unknown location aborts',
    sql: "update list_items set packing_location_id='nonexistent' where id='li-chk'",
    expectErrorMatch: /does not belong to this list/ },
  // 8. parent immutability fires (the rev-3 hole)
  { migration: '0014_packing-locations.sql', description: 'moving a location to another list aborts',
    sql: "update packing_locations set list_id='list-seed-3' where id='pl-chk'",
    expectErrorMatch: /cannot change list or owner/ },
  // 9. cap fires: pl-chk is 1; a recursive insert of 30 more makes the 31st abort
  { migration: '0014_packing-locations.sql', description: 'packing-location cap enforced',
    sql: "insert into packing_locations (id,user_id,list_id,name,sort_order,created_at,updated_at) with recursive c(x) as (select 1 union all select x+1 from c where x<30) select 'cap-'||x,'u-seed','list-seed','Cap'||x,x,0,0 from c",
    expectErrorMatch: /packing location cap exceeded/ },
  { migration: '0015_item-backed-containers.sql', description: 'container source column is TEXT',
    sql: "select upper(type) as type from pragma_table_info('packing_locations') where name='container_list_item_id'",
    expectRows: [{ type: 'TEXT' }] },
  { migration: '0015_item-backed-containers.sql', description: 'container source is unique',
    sql: "select name from sqlite_master where type='index' and name='packing_locations_container_item_unique'",
    expectRows: [{ name: 'packing_locations_container_item_unique' }] },
  { migration: '0015_item-backed-containers.sql', description: 'cross-list container source aborts',
    sql: "update packing_locations set container_list_item_id='li-seed-2' where id='pl-seed'",
    expectErrorMatch: /container item does not belong to this list/ },
  { migration: '0015_item-backed-containers.sql', description: 'setup: valid item-backed location',
    sql: "update packing_locations set container_list_item_id='li-seed' where id='pl-seed' returning id,container_list_item_id as containerListItemId",
    expectRows: [{ id: 'pl-seed', containerListItemId: 'li-seed' }] },
  { migration: '0015_item-backed-containers.sql', description: 'container source cannot contain itself',
    sql: "update list_items set packing_location_id='pl-seed' where id='li-seed'",
    expectErrorMatch: /container nesting cycle/ },
  { migration: '0015_item-backed-containers.sql', description: 'one item cannot back two locations',
    sql: "insert into packing_locations (id,user_id,list_id,name,container_list_item_id,sort_order,created_at,updated_at) values ('pl-duplicate-source','u-seed','list-seed','Duplicate','li-seed',2,0,0)",
    expectErrorMatch: /unique/i },
  { migration: '0015_item-backed-containers.sql', description: 'setup: disposable container source',
    sql: "insert into list_items (id,user_id,list_id,gear_item_id,quantity,is_worn,is_consumable,is_packed,is_ready,packing_location_id,sort_order,created_at,updated_at) values ('li-container-chk','u-seed','list-seed-3','gear-seed',1,0,0,0,0,null,92,0,0) returning id",
    expectRows: [{ id: 'li-container-chk' }] },
  { migration: '0015_item-backed-containers.sql', description: 'setup: disposable container contents',
    sql: "insert into list_items (id,user_id,list_id,gear_item_id,quantity,is_worn,is_consumable,is_packed,is_ready,packing_location_id,sort_order,created_at,updated_at) values ('li-content-chk','u-seed','list-seed-3','gear-seed',1,0,0,0,0,null,93,0,0) returning id",
    expectRows: [{ id: 'li-content-chk' }] },
  { migration: '0015_item-backed-containers.sql', description: 'setup: disposable item-backed location',
    sql: "insert into packing_locations (id,user_id,list_id,name,container_list_item_id,sort_order,created_at,updated_at) values ('pl-lifecycle-chk','u-seed','list-seed-3','Container','li-container-chk',0,0,0) returning id",
    expectRows: [{ id: 'pl-lifecycle-chk' }] },
  { migration: '0015_item-backed-containers.sql', description: 'setup: assign disposable contents',
    sql: "update list_items set packing_location_id='pl-lifecycle-chk' where id='li-content-chk' returning id",
    expectRows: [{ id: 'li-content-chk' }] },
  { migration: '0015_item-backed-containers.sql', description: 'deleting source removes role and unassigns contents',
    sql: "delete from list_items where id='li-container-chk' returning id",
    expectRows: [{ id: 'li-container-chk' }] },
  { migration: '0015_item-backed-containers.sql', description: 'container cascade left contents intact and unassigned',
    sql: "select (select count(*) from packing_locations where id='pl-lifecycle-chk') as locationCount, packing_location_id as packingLocationId from list_items where id='li-content-chk'",
    expectRows: [{ locationCount: 0, packingLocationId: null }] },

  // 0018: pack_sort_order is a rank WITHIN a cohort, not a second list-wide
  // sequence. These pin exact values rather than "contiguous", because a
  // list-wide backfill would also be contiguous - and would be wrong.
  //
  // list-seed holds two cohorts at backfill time. Ordered by sort_order:
  //   pl-seed:    li-cohort-a2 (10) -> 0, li-cohort-a1 (40) -> 1
  //   Unassigned: li-seed (0)        -> 0, li-cohort-u1 (30) -> 1
  //
  // Rank 0 appearing TWICE in one list is the whole assertion. A list-wide
  // sequence could not produce it, and would have given a1 and u1 distinct
  // global ranks that later interleave when a location is deleted. Gapped
  // source ranks (10, 30, 40) also prove the backfill ranks by ORDER rather
  // than copying sort_order across.
  { migration: '0018_pack-sort-order.sql', description: 'backfill ranks each cohort from 0, independently',
    sql: "select id, pack_sort_order as rank from list_items where id in ('li-seed','li-cohort-a2','li-cohort-a1','li-cohort-u1') order by id",
    expectRows: [
      { id: 'li-cohort-a1', rank: 1 },
      { id: 'li-cohort-a2', rank: 0 },
      { id: 'li-cohort-u1', rank: 1 },
      { id: 'li-seed', rank: 0 },
    ] },
  { migration: '0018_pack-sort-order.sql', description: 'no committed rank is negative',
    sql: "select count(*) as negatives from list_items where pack_sort_order < 0",
    expectRows: [{ negatives: 0 }] },
  { migration: '0018_pack-sort-order.sql', description: 'both uniqueness indexes exist',
    sql: "select name from sqlite_master where type='index' and name in ('list_items_pack_cohort_uq','list_items_pack_unassigned_uq') order by name",
    expectRows: [{ name: 'list_items_pack_cohort_uq' }, { name: 'list_items_pack_unassigned_uq' }] },
  { migration: '0018_pack-sort-order.sql', description: 'a duplicate rank in a located cohort is rejected',
    sql: "insert into list_items (id,user_id,list_id,gear_item_id,quantity,is_worn,is_consumable,is_packed,is_ready,packing_location_id,sort_order,pack_sort_order,created_at,updated_at) values ('li-dup-loc','u-seed','list-seed','gear-seed',1,0,0,0,0,'pl-seed',99,1,0,0)",
    expectErrorMatch: /unique/i },
  // SQLite treats NULLs as distinct in a unique index, so the composite index
  // above does NOT cover Unassigned. This proves the partial index does.
  { migration: '0018_pack-sort-order.sql', description: 'a duplicate rank in the unassigned cohort is rejected too',
    sql: "insert into list_items (id,user_id,list_id,gear_item_id,quantity,is_worn,is_consumable,is_packed,is_ready,packing_location_id,sort_order,pack_sort_order,created_at,updated_at) values ('li-dup-un','u-seed','list-seed','gear-seed',1,0,0,0,0,null,98,0,0,0)",
    expectErrorMatch: /unique/i },
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
    "select m.type, m.name, m.tbl_name from sqlite_master m where m.type in ('trigger', 'index') " +
      "and m.name not glob 'sqlite_*' and m.tbl_name not glob 'sqlite_*' " +
      "and m.tbl_name not glob '_cf_*' and m.tbl_name <> 'd1_migrations'",
  ).map(({ type, name, tbl_name }) => ({ label: `${type} ${name}`, table: tbl_name }))

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

// Every column's DECLARED type, as "table.column" -> type. Guards the one hole
// that canonicalize() opens: because the value comparison now ignores numeric
// FORMATTING, an unintended integer -> real rebuild of some other column would
// no longer show up as a changed value (45000 vs 45000.0 compare equal). The
// declared type is what catches that instead, and it is a stronger check than
// the one it replaces - previously nothing verified column types at all.
const describeColumnTypes = () => {
  const rows = query(
    'select m.name as tbl, p.name as col, p.type as type from sqlite_master m ' +
      `join pragma_table_info(m.name) p where ${appTablesFilter('m')}`,
  )
  return new Map(rows.map(({ tbl, col, type }) => [`${tbl}.${col}`, String(type).toUpperCase()]))
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
      resultSets[i].map(({ row }) => canonicalize(row)).sort(),
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
    const typesBefore = describeColumnTypes()
    const seededRows = [...before.values()].reduce((n, rows) => n + rows.length, 0)
    console.log(`Seeded ${seededRows} rows across ${before.size} tables.`)

    // 3. Apply the new migrations, exactly as deploy.yml does in production.
    for (const [file, contents] of held) writeFileSync(file, contents)

    console.log('\nApplying the new migrations...')
    applyMigrations()

    // 4. Nothing may have been lost or corrupted - except the rewrites the
    // new migrations DECLARED, which must have happened exactly as declared.
    // Tables this branch declared it drops are read neither here nor below:
    // they no longer exist, and every OTHER table's rows still get compared,
    // which is what proves the drop did not cascade into surviving data.
    const droppedTables = new Set(
      DROPPED_TABLES.filter((d) => addedNames.has(d.migration)).map((d) => d.table),
    )
    // Declared-dropped columns come out of the compared column set. Quoting a
    // column SQLite no longer has would silently read back as the column NAME
    // (its double-quoted-string fallback), which reads as a corrupted value
    // rather than an absent one.
    const droppedColumns = new Map()
    for (const d of DROPPED_COLUMNS) {
      if (!addedNames.has(d.migration)) continue
      if (!droppedColumns.has(d.table)) droppedColumns.set(d.table, new Set())
      droppedColumns.get(d.table).add(d.column)
    }
    const survivingColumns = new Map(
      [...seededColumns]
        .filter(([table]) => !droppedTables.has(table))
        .map(([table, cols]) => [
          table,
          cols.filter((col) => !droppedColumns.get(table)?.has(col)),
        ]),
    )
    const stillPresent = new Set(listTables())
    const notActuallyDropped = [...droppedTables].filter((t) => stillPresent.has(t))
    if (notActuallyDropped.length > 0) {
      throw new Error(
        `DROPPED_TABLES names ${notActuallyDropped.join(', ')}, but the ` +
          'migration left them in place. Either the drop did not run or the ' +
          'declaration is stale.',
      )
    }

    const after = snapshot(survivingColumns)
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
    const typesAfter = describeColumnTypes()
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
    const schemaAfter = new Set(listSchemaObjects().map((o) => o.label))
    const allowedGone = new Set(
      DROPPED_SCHEMA_OBJECTS.filter((d) => addedNames.has(d.migration)).map((d) => d.object),
    )
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

    // One-shot probes for the migrations this branch introduces. Run AFTER the
    // snapshots so a probe that unexpectedly succeeds cannot contaminate the
    // row comparison above.
    for (const check of POST_CHECKS) {
      if (!addedNames.has(check.migration)) continue
      const problem = check.expectErrorMatch
        ? expectSqlError(check.sql, check.expectErrorMatch)
        : expectSqlRows(check.sql, check.expectRows)
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
    const transientTables = new Set(TRANSIENT_TABLES.map((t) => t.table))
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

    // A transient table earns its fixture exemption by proving the thing that
    // makes it transient: it exists, and it is empty.
    for (const { table, why } of TRANSIENT_TABLES) {
      if (!tablesAfter.includes(table)) {
        failures.push(
          `Declared transient table ${table} does not exist after migration. ` +
            'Either the migration that creates it is missing, or the ' +
            'TRANSIENT_TABLES entry is stale.',
        )
        continue
      }
      const rows = query(`select count(*) as n from \`${table}\``)
      const n = Number(rows?.[0]?.n ?? -1)
      if (n !== 0) {
        failures.push(
          `Transient table ${table} holds ${n} row(s) after migration; it must ` +
            `be empty (${why}).`,
        )
      }
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
