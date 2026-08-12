import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema'

// App-owned tables. Auth tables live in auth-schema.ts (CLI-generated,
// never hand-edited); everything the app itself owns goes here.
//
// Conventions (SECURITY.md, REWRITE_PLAN.md section 6): every app table
// carries user_id with ON DELETE CASCADE from user; child references are
// composite same-owner FKs (ADR 12 continuity) anchored on UNIQUE(id,
// user_id); timestamps are epoch-ms integers (repos convert to ISO at the
// DTO edge); CHECKs mirror the old Postgres schema's bounds as the
// backstop against programmer error - friendly validation lives in the
// shared zod DTOs.

// Fixed-window rate limit counters, one row per scope+client key
// (e.g. "sign-in:203.0.113.10"). Plain SQLite, written through a single
// atomic upsert in server/middleware/rate-limit.ts - portable to the
// Node+SQLite target unchanged.
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStart: integer('window_start').notNull(), // epoch ms
})

// Gear categories. No seeding: "Uncategorized" is the UI rendering of a
// null gear_items.category_id, not a row. The old schema's is_default
// column was dropped in the port (always false, never read).
export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(), // epoch ms
  },
  (t) => [
    // Composite-FK target for same-owner references from gear_items.
    unique('categories_id_user_unique').on(t.id, t.userId),
    index('categories_user_sort_idx').on(t.userId, t.sortOrder, t.name),
    check(
      'categories_name_length',
      sql`length(${t.name}) between 1 and 128`,
    ),
  ],
)

// The gear inventory. category_id is nullable (null renders as
// "Uncategorized"); the composite FK guarantees a non-null category
// belongs to the SAME user. SQLite has no column-list ON DELETE SET NULL
// (setting user_id null would violate NOT NULL), so the FK is NO ACTION
// and category deletion is a repo-owned atomic batch: [uncategorize gear,
// delete category]. The 500-per-user cap trigger lives in migration 0003
// (drizzle has no trigger DSL) and is the single enforcement point; the
// repo maps its error to a friendly 422. CAUTION: the drizzle snapshot
// does not know the trigger exists - any future migration that rebuilds
// gear_items (SQLite ALTERs via table recreate) must recreate it by hand.
export const gearItems = sqliteTable(
  'gear_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    categoryId: text('category_id'),
    name: text('name').notNull(),
    description: text('description'),
    // REAL, not integer: gear weights carry tenths of a gram (it matters when
    // packing multiples of a small item). REAL because gear weights are summed
    // into one pack
    // total (src/lib/weight-breakdown.ts), so they must share a representation.
    // Unlike money, weight is never compared for exact equality across
    // independently-computed values, so integer sub-units buy nothing here.
    weightGrams: real('weight_grams').notNull().default(0),
    // Integer cents (exact); DTOs speak dollars. numeric(10,2) does not
    // exist in SQLite and REAL is the wrong tool for money.
    costCents: integer('cost_cents'),
    purchaseDate: text('purchase_date'), // ISO YYYY-MM-DD
    status: text('status').notNull().default('active'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(), // epoch ms
    updatedAt: integer('updated_at').notNull(), // epoch ms, repo-maintained
  },
  (t) => [
    // Composite-FK target for same-owner references from list_items
    // (phase 3).
    unique('gear_items_id_user_unique').on(t.id, t.userId),
    index('gear_items_user_sort_idx').on(t.userId, t.sortOrder, t.name),
    foreignKey({
      name: 'gear_items_category_same_owner_fk',
      columns: [t.categoryId, t.userId],
      foreignColumns: [categories.id, categories.userId],
    }),
    check('gear_items_name_length', sql`length(${t.name}) between 1 and 256`),
    check(
      'gear_items_description_length',
      sql`${t.description} is null or length(${t.description}) <= 2000`,
    ),
    check(
      'gear_items_weight_range',
      sql`${t.weightGrams} between 0 and 100000`,
    ),
    check(
      'gear_items_cost_range',
      sql`${t.costCents} is null or (${t.costCents} between 0 and 9999999999)`,
    ),
    check(
      'gear_items_purchase_date_shape',
      sql`${t.purchaseDate} is null or ${t.purchaseDate} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check(
      'gear_items_status_enum',
      sql`${t.status} in ('active', 'needs_repair', 'loaned_out', 'need_to_buy')`,
    ),
  ],
)

// Pack lists. slug is minted server-side at insert (6-char base62,
// crypto-random) and lives in the schema from day one even though the
// public share routes are a later slice - adding a NOT NULL UNIQUE
// column later would force a table rebuild, and rebuilds silently drop
// the hand-written cap trigger (see the 0003 caveat above). is_shared
// stays false until the share slice ships its routes. is_draft defaults
// true (the old app's final behavior): a label only, never a lock.
// The 100-per-user cap trigger lives in migration 0004; same caveats as
// the gear cap trigger. Migration 0009 recreated lists_user_cap by hand after
// a table rebuild, and any future rebuild must do the same.
export const lists = sqliteTable(
  'lists',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    slug: text('slug').notNull(),
    isShared: integer('is_shared', { mode: 'boolean' }).notNull().default(false),
    // RETIRED 2026-08-11, and deliberately still here. Nothing reads or
    // writes either one: they are off every DTO, refused on PATCH (the
    // request schema is strict), and no longer copied by list duplication.
    //
    // Dropping a column means a SQLite table REBUILD, and rebuilding `lists`
    // fires the cascades that delete every list_items row (AGENTS.md,
    // docs/incidents.md). Inert columns are the cheap outcome; a rebuild is
    // the expensive one. Do not "tidy" these away.
    //
    // group_worn was a per-list worn-grouping preference the share view was
    // documented to honor and never did. ready_checks_enabled was a per-list
    // opt-in for the Ready column, now unconditional. is_ready on each item
    // was always independent of the flag, so no tick was ever lost to it.
    groupWorn: integer('group_worn', { mode: 'boolean' }).notNull().default(false),
    readyChecksEnabled: integer('ready_checks_enabled', { mode: 'boolean' })
      .notNull()
      .default(false),
    isDraft: integer('is_draft', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(), // epoch ms
    updatedAt: integer('updated_at').notNull(), // epoch ms, repo-maintained
  },
  (t) => [
    // Composite-FK target for same-owner references from list_items.
    unique('lists_id_user_unique').on(t.id, t.userId),
    unique('lists_slug_unique').on(t.slug),
    index('lists_user_sort_idx').on(t.userId, t.sortOrder, t.name),
    check('lists_name_length', sql`length(${t.name}) between 1 and 256`),
    check(
      'lists_description_length',
      sql`${t.description} is null or length(${t.description}) <= 2000`,
    ),
    check('lists_slug_shape', sql`length(${t.slug}) = 6`),
  ],
)

// Per-list physical organization for Pack Mode. A location belongs to one
// list and owner; list_items may point at one location through the nullable
// packing_location_id column below. The single-column FK is intentional so
// ON DELETE SET NULL can clear only the assignment. Same-list/same-owner
// integrity is restored by the triggers in migration 0014.
export const packingLocations = sqliteTable(
  'packing_locations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    listId: text('list_id').notNull(),
    name: text('name').notNull(),
    // Null for a name-only location. When present, this location is backed by
    // a real membership row on the same list. The stored name is a creation
    // snapshot used while inserting/duplicating the graph; authenticated reads
    // join through the item to its gear row so later gear renames stay live.
    // The FK cascade removes the container role when that membership row goes
    // away; list_items.packing_location_id then SET NULLs the contents.
    containerListItemId: text('container_list_item_id').references(
      (): AnySQLiteColumn => listItems.id,
      { onDelete: 'cascade' },
    ),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    unique('packing_locations_id_user_unique').on(t.id, t.userId),
    unique('packing_locations_id_list_user_unique').on(
      t.id,
      t.listId,
      t.userId,
    ),
    index('packing_locations_list_sort_idx').on(t.listId, t.sortOrder),
    uniqueIndex('packing_locations_container_item_unique').on(
      t.containerListItemId,
    ),
    foreignKey({
      name: 'packing_locations_list_same_owner_fk',
      columns: [t.listId, t.userId],
      foreignColumns: [lists.id, lists.userId],
    }).onDelete('cascade'),
    check(
      'packing_locations_name_length',
      sql`length(${t.name}) between 1 and 60`,
    ),
  ],
)

// List membership rows. Weight/cost/etc. live only on gear_items - the
// list reads them through the join (the old repo dropped its duplicated
// weight_grams column for exactly this reason). Both parent FKs are
// composite same-owner AND cascading: deleting a list removes its rows,
// deleting a gear item removes it from every list (old-app behavior).
// Cascade is safe where gear->categories' SET NULL was not - a cascade
// deletes the whole row, so the "can't null one column of a composite
// FK" problem never arises. No UNIQUE(list_id, gear_item_id): the old
// schema allowed the same gear twice in a list, and quantity is not a
// substitute for that in every workflow. The 300-per-list cap trigger
// lives in migration 0004.
export const listItems = sqliteTable(
  'list_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    listId: text('list_id').notNull(),
    gearItemId: text('gear_item_id').notNull(),
    quantity: integer('quantity').notNull().default(1),
    isWorn: integer('is_worn', { mode: 'boolean' }).notNull().default(false),
    isConsumable: integer('is_consumable', { mode: 'boolean' })
      .notNull()
      .default(false),
    isPacked: integer('is_packed', { mode: 'boolean' }).notNull().default(false),
    isReady: integer('is_ready', { mode: 'boolean' }).notNull().default(false),
    packingLocationId: text('packing_location_id').references(
      () => packingLocations.id,
      { onDelete: 'set null' },
    ),
    // DOCUMENT order. List view, the public share and CSV read this, and only
    // a List-view reorder writes it. It used to be the ONLY order, which meant
    // arranging your pack rewrote the list you had written - and rewrote the
    // public share link, because the anonymous read orders by this column.
    sortOrder: integer('sort_order').notNull().default(0),
    // PACKING order, and it is NOT a second list-wide sequence. It is a rank
    // within this row's packing COHORT - the set of rows sharing
    // (list_id, packing_location_id), where a null location is the Unassigned
    // cohort. A list-wide pack rank looks equivalent until a location is
    // deleted: its orphans would interleave into Unassigned by ranks that
    // encode old cross-location accidents rather than anything the user
    // arranged.
    //
    // Committed values are ALWAYS nonnegative. Negatives exist only between
    // the two phases of a permutation write (see below) and never survive the
    // batch. That is deliberately NOT a CHECK constraint: a check is evaluated
    // per statement and would reject phase 1.
    //
    // Worn rows keep a rank and reserve their slot even though they render
    // outside the packing tree, so toggling worn costs zero ordering writes
    // and returns the row to where it was.
    packSortOrder: integer('pack_sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(), // epoch ms
    updatedAt: integer('updated_at').notNull(), // epoch ms, repo-maintained
  },
  (t) => [
    index('list_items_user_list_sort_idx').on(t.userId, t.listId, t.sortOrder),
    // Leading list_id: the cap trigger's count and (later) the share
    // fetch both filter by list alone.
    index('list_items_list_sort_idx').on(t.listId, t.sortOrder),
    index('list_items_gear_item_user_idx').on(t.gearItemId, t.userId),
    index('list_items_packing_location_idx').on(t.packingLocationId),
    // UNIQUE, and that is load-bearing rather than tidiness. Validate-then-
    // batch cannot hold the rank invariant: two concurrent reorders of one
    // cohort planned from the same read (A=0,B=1,C=2; one plans A=1,B=0, the
    // other B=2,C=1) both validate, and the second commit leaves A and C both
    // at 1. Conditional updates do not save it either - the losing statement
    // matches nothing while its sibling still applies. With a unique index the
    // loser violates the constraint and D1 rolls the whole batch back, which
    // the route turns into a 409 and the client refetches.
    //
    // Consequence: SQLite enforces uniqueness per STATEMENT, so a permutation
    // written as a sequence of updates transiently collides. Every writer that
    // PERMUTES within a cohort is two-phase inside one batch - shift the
    // touched rows to `-1 - i`, then write finals. Appends skip phase 1.
    uniqueIndex('list_items_pack_cohort_uq').on(
      t.listId,
      t.packingLocationId,
      t.packSortOrder,
    ),
    // SQLite treats every NULL as DISTINCT in a unique index, so the index
    // above does not constrain the Unassigned cohort at all. Without this
    // partial index Unassigned would keep exactly the corruption the other one
    // exists to prevent.
    uniqueIndex('list_items_pack_unassigned_uq')
      .on(t.listId, t.packSortOrder)
      .where(sql`${t.packingLocationId} is null`),
    foreignKey({
      name: 'list_items_list_same_owner_fk',
      columns: [t.listId, t.userId],
      foreignColumns: [lists.id, lists.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'list_items_gear_same_owner_fk',
      columns: [t.gearItemId, t.userId],
      foreignColumns: [gearItems.id, gearItems.userId],
    }).onDelete('cascade'),
    check('list_items_quantity_range', sql`${t.quantity} between 1 and 9999`),
    check(
      'list_items_worn_xor_consumable',
      sql`not (${t.isWorn} and ${t.isConsumable})`,
    ),
  ],
)

// ── Food ──────────────────────────────────────────────────────────────────
//
// A food WEIGHT ESTIMATE, not a meal planner. The previous food domain (10
// tables, nutrition, targets, reusable plans, a library) was deleted in
// migration 0016 for being far more machinery than the job needed. This is the
// small replacement, and the boundary is deliberate: no calories, no macros,
// no targets, no library, no plans reusable across lists.
//
// The model is three tables because of ONE fact that cannot be compressed: a
// food entry is a THING YOU CARRY, not a placement. One 500 g bag of trail mix
// eaten across five lunches is a single 500 g row associated with five slots.
// Storing a row per placement would either multiply its weight by five - a
// wrong pack weight, which is the number this whole app exists to compute - or
// need an implicit grouping identity, which is a join table wearing a disguise.
//
// So: slots are the trip's eating periods, items are what you carry, and the
// association between them expresses intent ONLY. It is never part of a sum.

export const listFoodSlots = sqliteTable(
  'list_food_slots',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    listId: text('list_id').notNull(),
    dayNumber: integer('day_number').notNull(),
    meal: text('meal', { enum: ['breakfast', 'lunch', 'dinner'] }).notNull(),
    // The three-state distinction the feature exists for. needed + no
    // associations = "you forgot this meal"; needed=false = "you deliberately
    // skipped it" (breakfast on day 1, eaten in the car). Collapsing those two
    // into one blank is exactly the omission this is meant to catch.
    needed: integer('needed', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    unique('list_food_slots_id_user_unique').on(t.id, t.userId),
    // The composite-FK target the association table references. The TRIPLE is
    // load-bearing: FKs on (id, user_id) alone would only prove the slot
    // belongs to SOME list of this user, so an item on list A could be
    // associated with a slot on list B. Same convention as packing_locations.
    unique('list_food_slots_id_list_user_unique').on(t.id, t.listId, t.userId),
    unique('list_food_slots_day_meal_unique').on(t.listId, t.dayNumber, t.meal),
    index('list_food_slots_list_day_idx').on(t.listId, t.dayNumber),
    foreignKey({
      name: 'list_food_slots_list_same_owner_fk',
      columns: [t.listId, t.userId],
      foreignColumns: [lists.id, lists.userId],
    }).onDelete('cascade'),
    // The drizzle text enum above is a TypeScript aid only; this is what the
    // database actually enforces.
    check(
      'list_food_slots_meal_enum',
      sql`${t.meal} in ('breakfast', 'lunch', 'dinner')`,
    ),
    // Also the day ceiling. There is deliberately NO row-count cap trigger
    // here: this table holds three rows per day, so the repo's usual
    // count-based convention would cap the feature at ten days.
    //
    // typeof() is load-bearing, not belt-and-braces. These are not STRICT
    // tables, so an `integer` column happily stores 1.5 - and `between 1 and
    // 30` accepts every fractional value in that range, which turns a 90-slot
    // ceiling into a practically unbounded one. Adding this later would need a
    // table rebuild with cascading children, so it goes in before deploy.
    check(
      'list_food_slots_day_range',
      sql`typeof(${t.dayNumber}) = 'integer' and ${t.dayNumber} between 1 and 30`,
    ),
  ],
)

export const listFoodItems = sqliteTable(
  'list_food_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    listId: text('list_id').notNull(),
    name: text('name').notNull(),
    // REAL for the same reason gear weights are: a single item's weight
    // carries tenths.
    weightGrams: real('weight_grams').notNull(),
    // UNITS CARRIED, and nothing derives it. Associating an item with five
    // slots must never touch this: the app cannot tell five packets from one
    // shared bag, and guessing inflates the pack weight silently.
    quantity: integer('quantity').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    // Pack state, added by 0022. Food is a full peer of gear in Pack mode:
    // packable, bag-assignable, rank-ordered. The columns and their indexes
    // mirror list_items exactly; the semantics (cohort ranks, the negative
    // scratch band, the union rank space shared with gear at read time) are
    // documented on list_items.packSortOrder and in migration 0022's header.
    isPacked: integer('is_packed', { mode: 'boolean' }).notNull().default(false),
    isReady: integer('is_ready', { mode: 'boolean' }).notNull().default(false),
    packingLocationId: text('packing_location_id').references(
      () => packingLocations.id,
      { onDelete: 'set null' },
    ),
    packSortOrder: integer('pack_sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    unique('list_food_items_id_user_unique').on(t.id, t.userId),
    unique('list_food_items_id_list_user_unique').on(t.id, t.listId, t.userId),
    index('list_food_items_list_sort_idx').on(t.listId, t.sortOrder),
    index('list_food_items_packing_location_idx').on(t.packingLocationId),
    // Mirrors list_items_pack_cohort_uq / list_items_pack_unassigned_uq; the
    // full rationale (why UNIQUE is load-bearing, why the partial index for
    // NULL locations) lives on those.
    uniqueIndex('list_food_items_pack_cohort_uq').on(
      t.listId,
      t.packingLocationId,
      t.packSortOrder,
    ),
    uniqueIndex('list_food_items_pack_unassigned_uq')
      .on(t.listId, t.packSortOrder)
      .where(sql`${t.packingLocationId} is null`),
    foreignKey({
      name: 'list_food_items_list_same_owner_fk',
      columns: [t.listId, t.userId],
      foreignColumns: [lists.id, lists.userId],
    }).onDelete('cascade'),
    check(
      'list_food_items_name_length',
      sql`length(${t.name}) between 1 and 128`,
    ),
    check(
      'list_food_items_weight_range',
      sql`${t.weightGrams} between 0 and 100000`,
    ),
    // typeof() for the same affinity reason as day_number above, and here it
    // is a WEIGHT correctness issue rather than a bound: a stored quantity of
    // 1.5 makes a 500 g item weigh 750 g. "Units carried" has to mean units.
    check(
      'list_food_items_quantity_range',
      sql`typeof(${t.quantity}) = 'integer' and ${t.quantity} between 1 and 9999`,
    ),
  ],
)

// Which slots a carried item is intended for. Expresses INTENT ONLY - this
// table is never joined into a weight sum. The obvious query (join items to
// slots, sum weight x quantity) returns 2500 g for one 500 g bag on five
// lunches, and is the single most dangerous statement anyone could write here.
export const listFoodItemSlots = sqliteTable(
  'list_food_item_slots',
  {
    foodItemId: text('food_item_id').notNull(),
    slotId: text('slot_id').notNull(),
    userId: text('user_id').notNull(),
    // Denormalized so the two FKs below can prove BOTH parents sit on the SAME
    // list. Referencing (id, user_id) on each parent independently proves only
    // that each belongs to some list this user owns - which permits an item on
    // list A to be stitched to a slot on list B.
    listId: text('list_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.foodItemId, t.slotId] }),
    index('list_food_item_slots_slot_idx').on(t.slotId),
    index('list_food_item_slots_list_idx').on(t.listId),
    foreignKey({
      name: 'list_food_item_slots_item_same_list_fk',
      columns: [t.foodItemId, t.listId, t.userId],
      foreignColumns: [listFoodItems.id, listFoodItems.listId, listFoodItems.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'list_food_item_slots_slot_same_list_fk',
      columns: [t.slotId, t.listId, t.userId],
      foreignColumns: [listFoodSlots.id, listFoodSlots.listId, listFoodSlots.userId],
    }).onDelete('cascade'),
    // Defence in depth, not the same-list proof.
    foreignKey({
      name: 'list_food_item_slots_list_same_owner_fk',
      columns: [t.listId, t.userId],
      foreignColumns: [lists.id, lists.userId],
    }).onDelete('cascade'),
  ],
)

// TRANSIENT. Correct only when EMPTY. A row exists solely between the park and
// settle statements of one `reorderPack` batch, and the same batch deletes it.
//
// It exists because a D1 batch cannot branch on an earlier statement's result,
// and a conditional UPDATE matching zero rows is not an error in SQLite - so
// "abort if the parks did not all land" has to be expressed as a statement that
// FAILS. Feeding NULL into `ok` (NOT NULL) is that failure, and D1 rolls the
// whole batch back with it.
//
// Declared in scripts/check-migration-safety.mjs's TRANSIENT_TABLES, which
// asserts presence and emptiness rather than demanding a fixture row. Created
// by migration 0019.
export const packReorderGuard = sqliteTable('_pack_reorder_guard', {
  listId: text('list_id').primaryKey(),
  ok: integer('ok').notNull(),
})

// TRANSIENT. Correct only when EMPTY. Rows exist solely between the two UPDATE
// statements of the packing_locations delete trigger, which deletes them again
// before it returns.
//
// It holds the FINAL rank for every row in the affected cohort, materialized
// before anything moves. That ordering is the point: computing a dense ordinal
// inside the UPDATE would be self-referencing, because rows already updated
// have had their packing_location_id set to NULL and drop out of the count.
//
// No repo writes to it - the trigger owns it entirely. It is declared here so
// drizzle-kit's snapshot matches the deployed schema. Created by migration
// 0020.
export const packingLocationDeleteState = sqliteTable(
  '_packing_location_delete_state',
  {
    listItemId: text('list_item_id').primaryKey(),
    newRank: integer('new_rank').notNull(),
    // A small dense ordinal for the negative park slot. `newRank` cannot serve
    // as one: on the offset path it can be far larger than the reserved
    // scratch range allows.
    seq: integer('seq').notNull(),
  },
)

// TRANSIENT, same contract as _pack_reorder_guard, for the food half of a
// union pack reorder. A separate table because one reorder batch parks BOTH
// list_items and list_food_items rows and each table's park count must be
// checked independently - and the gear guard's PRIMARY KEY is already the
// list id. Created by migration 0022.
export const foodPackReorderGuard = sqliteTable('_food_pack_reorder_guard', {
  listId: text('list_id').primaryKey(),
  ok: integer('ok').notNull(),
})

// TRANSIENT, same contract as _packing_location_delete_state, owned entirely
// by the packing_locations_rerank_food_orphans trigger. Created by migration
// 0022.
export const foodLocationDeleteState = sqliteTable(
  '_food_location_delete_state',
  {
    foodItemId: text('food_item_id').primaryKey(),
    newRank: integer('new_rank').notNull(),
    seq: integer('seq').notNull(),
  },
)

// TRANSIENT. Used exactly once, by migration 0023's repair step, then emptied
// - it persists only because the destructive-DDL gate (correctly) refuses a
// DROP TABLE in post-baseline migrations. Nothing at runtime reads or writes
// it; declared so drizzle-kit's snapshot matches the deployed schema.
export const foodRankRepair = sqliteTable('_food_rank_repair', {
  foodItemId: text('food_item_id').primaryKey(),
  newRank: integer('new_rank').notNull(),
})
