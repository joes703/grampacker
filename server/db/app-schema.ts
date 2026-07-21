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
    // packing multiples of a small item). Matches food_items.serving_weight_grams,
    // which is already REAL - gear and food weights are summed into one pack
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
// the gear cap trigger - and food_plan_id (slice 3) forces exactly such a
// rebuild, so migration 0009 recreates lists_user_cap by hand.
//
// food_plan_id is a LIVE REFERENCE to a standalone food plan
// (food-planning-design.md 2.1): nullable (most lists have no plan), and a
// plan backs AT MOST ONE list - a menu is a per-trip decision, so reuse is
// duplication, never sharing (design revision 2026-07-16, superseding 12.1's
// many-lists model). The partial unique index below is the structural
// backstop for that; repo prechecks only exist to give friendly errors.
// The FK is composite same-owner and NO ACTION, not
// SET NULL - SQLite has no column-list SET NULL (it would null user_id too, a
// NOT NULL violation), so deleting a plan is a repo-owned detach-then-delete
// batch (2.3), and the FK is the hard backstop that fails a skipped detach loud.
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
    foodPlanId: text('food_plan_id'), // nullable; -> food_plans (see FK below)
    isShared: integer('is_shared', { mode: 'boolean' }).notNull().default(false),
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
    // Live-reference to a food plan, composite same-owner (design 2.1). No
    // .onDelete() => NO ACTION: the plan-delete batch (2.3) detaches first, and
    // this FK is the backstop if it ever doesn't. foodPlans is declared LATER in
    // this file (it references nothing here, so no cycle); the callback form of
    // foreignKey defers resolution past that forward reference.
    foreignKey(() => ({
      name: 'lists_food_plan_same_owner_fk',
      columns: [t.foodPlanId, t.userId],
      foreignColumns: [foodPlans.id, foodPlans.userId],
    })),
    // One plan per trip: at most one list may reference a given plan. Partial
    // (WHERE NOT NULL) so the many plan-less lists don't collide on NULL.
    uniqueIndex('lists_food_plan_id_unique')
      .on(t.foodPlanId)
      .where(sql`${t.foodPlanId} is not null`),
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
    sortOrder: integer('sort_order').notNull().default(0),
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

// The food library: account-wide food definitions, exactly analogous to
// gear_items (account-wide, no list coupling). Ported column-for-column
// from the old Postgres table (20260611120000_food_items.sql).
//
// Fractional columns are REAL, not integer-scaled. The old schema typed
// them numeric(10,3)/(10,2)/(10,1); SQLite has no numeric type. The
// projection contract (food-planning-design.md 5.6/12.10) is "carry full
// precision through the math, round ONCE to integer grams at the boundary"
// on IEEE-754 doubles - the operands are JS doubles the moment they parse
// from JSON, so integer-scaled columns would not change the arithmetic,
// only add a scale/unscale layer. (REAL-is-wrong applies to MONEY, which
// must be exact to the cent; grams and kcal have no such requirement.)
//
// The NOT NULL / nullable asymmetry between serving_weight_grams and
// servings_per_package is LOAD-BEARING and preserved verbatim: a non-null
// positive serving weight is what makes `servings` and `weight` basis
// entries always projectable, and a NULL servings_per_package is the ONLY
// thing that can make a projection incomplete (design 5.4). Do not tidy it.
//
// The 1000-per-user cap trigger lives in migration 0007 (drizzle has no
// trigger DSL) and is the SINGLE enforcement point; the repo maps its
// RAISE(ABORT) message to a friendly 422. CAUTION: the drizzle snapshot
// does not track the trigger - any future migration that rebuilds
// food_items (SQLite ALTERs via table recreate) must recreate it by hand.
export const foodItems = sqliteTable(
  'food_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    brand: text('brand'),
    servingDescription: text('serving_description'),
    // NOT NULL, > 0: always projectable. See the asymmetry note above.
    servingWeightGrams: real('serving_weight_grams').notNull(),
    caloriesPerServing: real('calories_per_serving').notNull(),
    // Nullable: a by-weight food has no package count. A NULL here is the
    // incomplete-projection signal (design 5.4).
    servingsPerPackage: real('servings_per_package'),
    fatGrams: real('fat_grams'),
    saturatedFatGrams: real('saturated_fat_grams'),
    carbsGrams: real('carbs_grams'),
    fiberGrams: real('fiber_grams'),
    sugarGrams: real('sugar_grams'),
    proteinGrams: real('protein_grams'),
    sodiumMg: real('sodium_mg'),
    potassiumMg: real('potassium_mg'),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(), // epoch ms
    updatedAt: integer('updated_at').notNull(), // epoch ms, repo-maintained
  },
  (t) => [
    // Composite-FK target for same-owner references from food_plan_entries
    // (slice 2) and food_pack_state (slice 4). Landed with the table itself:
    // adding it later would force a table rebuild, which silently drops the
    // cap trigger.
    unique('food_items_id_user_unique').on(t.id, t.userId),
    index('food_items_user_sort_idx').on(t.userId, t.sortOrder, t.name),
    check('food_items_name_length', sql`length(${t.name}) between 1 and 256`),
    check(
      'food_items_brand_length',
      sql`${t.brand} is null or length(${t.brand}) <= 256`,
    ),
    check(
      'food_items_serving_description_length',
      sql`${t.servingDescription} is null or length(${t.servingDescription}) <= 256`,
    ),
    check(
      'food_items_notes_length',
      sql`${t.notes} is null or length(${t.notes}) <= 2000`,
    ),
    // Bounds mirror the old numeric(10,x) maxima. serving_weight_grams and
    // servings_per_package are numeric(10,3) and strictly > 0; the rest are
    // >= 0. sodium/potassium are numeric(10,1); the others numeric(10,2).
    check(
      'food_items_serving_weight_range',
      sql`${t.servingWeightGrams} > 0 and ${t.servingWeightGrams} <= 9999999.999`,
    ),
    check(
      'food_items_calories_range',
      sql`${t.caloriesPerServing} >= 0 and ${t.caloriesPerServing} <= 99999999.99`,
    ),
    check(
      'food_items_servings_per_package_range',
      sql`${t.servingsPerPackage} is null or (${t.servingsPerPackage} > 0 and ${t.servingsPerPackage} <= 9999999.999)`,
    ),
    check(
      'food_items_fat_range',
      sql`${t.fatGrams} is null or (${t.fatGrams} >= 0 and ${t.fatGrams} <= 99999999.99)`,
    ),
    check(
      'food_items_saturated_fat_range',
      sql`${t.saturatedFatGrams} is null or (${t.saturatedFatGrams} >= 0 and ${t.saturatedFatGrams} <= 99999999.99)`,
    ),
    check(
      'food_items_carbs_range',
      sql`${t.carbsGrams} is null or (${t.carbsGrams} >= 0 and ${t.carbsGrams} <= 99999999.99)`,
    ),
    check(
      'food_items_fiber_range',
      sql`${t.fiberGrams} is null or (${t.fiberGrams} >= 0 and ${t.fiberGrams} <= 99999999.99)`,
    ),
    check(
      'food_items_sugar_range',
      sql`${t.sugarGrams} is null or (${t.sugarGrams} >= 0 and ${t.sugarGrams} <= 99999999.99)`,
    ),
    check(
      'food_items_protein_range',
      sql`${t.proteinGrams} is null or (${t.proteinGrams} >= 0 and ${t.proteinGrams} <= 99999999.99)`,
    ),
    check(
      'food_items_sodium_range',
      sql`${t.sodiumMg} is null or (${t.sodiumMg} >= 0 and ${t.sodiumMg} <= 999999999.9)`,
    ),
    check(
      'food_items_potassium_range',
      sql`${t.potassiumMg} is null or (${t.potassiumMg} >= 0 and ${t.potassiumMg} <= 999999999.9)`,
    ),
  ],
)

// ---------------------------------------------------------- food plans (slice 2)
//
// A food plan is standalone and REUSABLE (food-planning-design.md D1/section 2):
// the analogue of a gear LIST, not a gear item. It gains a `name` and drops the
// old build's `list_id` (the link inverts in slice 3: lists.food_plan_id points
// AT a plan), `num_nights` (the day count is the count of food_plan_days rows -
// no second source of truth) and `is_food_shared` (D6: a share exposes weight
// only, gated by attachment, not a flag).
//
// The whole food-plan subtree is structurally self-sealing: every table carries
// user_id + food_plan_id and anchors its owner guard on the composite FK
// (food_plan_id, user_id) -> food_plans(id, user_id), so a cross-owner link is
// impossible at the schema level (ADR 12 continuity, same as list_items). The
// intra-plan FKs ((day_id, food_plan_id), (meal_id, food_plan_id),
// (day_meal_id, food_plan_id)) additionally forbid stitching a cell to a day or
// meal in a DIFFERENT plan.
//
// The 100-per-user cap trigger lives in migration 0008 (drizzle has no trigger
// DSL) and is the SINGLE enforcement point; the repo maps its RAISE(ABORT) to a
// friendly 422. Same snapshot caveat as food_items: a future rebuild must
// recreate the trigger by hand.
export const foodPlans = sqliteTable(
  'food_plans',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(), // epoch ms
    updatedAt: integer('updated_at').notNull(), // epoch ms, repo-maintained
  },
  (t) => [
    // Composite-FK target for the whole subtree's owner guard, AND for
    // lists.food_plan_id in slice 3 - it lands now so slice 3 adds no column
    // to this table (a rebuild would drop the cap trigger).
    unique('food_plans_id_user_unique').on(t.id, t.userId),
    index('food_plans_user_sort_idx').on(t.userId, t.sortOrder, t.name),
    check('food_plans_name_length', sql`length(${t.name}) between 1 and 256`),
  ],
)

// Plan-scoped meal definitions (Breakfast / On-trail food / Dinner seeded on
// create). anchor_role marks the two anchors used to derive a day's full/partial
// type (a targets concern, slice 7 - the column is ported and seeded now but has
// no dedicated UI in slice 2). is_default flags the seeded three. The 20-per-plan
// cap trigger lives in migration 0008.
export const meals = sqliteTable(
  'meals',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    foodPlanId: text('food_plan_id').notNull(),
    name: text('name').notNull(),
    // TS-only enum (drizzle emits plain text); the CHECK below is the DB
    // backstop, mirroring the old build's inline check.
    anchorRole: text('anchor_role', { enum: ['breakfast', 'dinner'] }),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    // Composite-FK target for (meal_id, food_plan_id) from day_meals.
    unique('meals_id_plan_unique').on(t.id, t.foodPlanId),
    foreignKey({
      name: 'meals_plan_same_owner_fk',
      columns: [t.foodPlanId, t.userId],
      foreignColumns: [foodPlans.id, foodPlans.userId],
    }).onDelete('cascade'),
    // At most one anchor per role per plan (one Breakfast, one Dinner).
    uniqueIndex('meals_one_anchor_per_role_idx')
      .on(t.foodPlanId, t.anchorRole)
      .where(sql`${t.anchorRole} is not null`),
    index('meals_plan_sort_idx').on(t.foodPlanId, t.sortOrder),
    index('meals_user_idx').on(t.userId),
    check('meals_name_length', sql`length(${t.name}) between 1 and 128`),
    check(
      'meals_anchor_role_enum',
      sql`${t.anchorRole} is null or ${t.anchorRole} in ('breakfast', 'dinner')`,
    ),
  ],
)

// Explicit day rows. The COUNT of these is authoritative for "how many days"
// (there is no num_nights). day_type_override forces a day full/partial; null
// means "auto" (derived from whether both anchor meals are scheduled) - a
// slice-7 targets concern, ported now. The 60-per-plan cap trigger lives in 0008.
export const foodPlanDays = sqliteTable(
  'food_plan_days',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    foodPlanId: text('food_plan_id').notNull(),
    dayTypeOverride: text('day_type_override', { enum: ['full', 'partial'] }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    // Composite-FK target for (day_id, food_plan_id) from day_meals.
    unique('food_plan_days_id_plan_unique').on(t.id, t.foodPlanId),
    foreignKey({
      name: 'food_plan_days_plan_same_owner_fk',
      columns: [t.foodPlanId, t.userId],
      foreignColumns: [foodPlans.id, foodPlans.userId],
    }).onDelete('cascade'),
    index('food_plan_days_plan_sort_idx').on(t.foodPlanId, t.sortOrder),
    index('food_plan_days_user_idx').on(t.userId),
    check(
      'food_plan_days_day_type_enum',
      sql`${t.dayTypeOverride} is null or ${t.dayTypeOverride} in ('full', 'partial')`,
    ),
  ],
)

// The day x meal grid. ONE row means "this meal is enabled on this day" (design
// 12.7): an empty cell is the ABSENCE of a row, which JSON could not express, so
// this stays a table. The two intra-plan FKs pin day_id and meal_id to the SAME
// plan; the (day_id, meal_id) unique makes each cell singular. No explicit cap -
// it is naturally bounded at 60 x 20 = 1200.
export const dayMeals = sqliteTable(
  'day_meals',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    foodPlanId: text('food_plan_id').notNull(),
    dayId: text('day_id').notNull(),
    mealId: text('meal_id').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    unique('day_meals_day_meal_unique').on(t.dayId, t.mealId),
    // Composite-FK target for (day_meal_id, food_plan_id) from entries.
    unique('day_meals_id_plan_unique').on(t.id, t.foodPlanId),
    foreignKey({
      name: 'day_meals_plan_same_owner_fk',
      columns: [t.foodPlanId, t.userId],
      foreignColumns: [foodPlans.id, foodPlans.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'day_meals_day_same_plan_fk',
      columns: [t.dayId, t.foodPlanId],
      foreignColumns: [foodPlanDays.id, foodPlanDays.foodPlanId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'day_meals_meal_same_plan_fk',
      columns: [t.mealId, t.foodPlanId],
      foreignColumns: [meals.id, meals.foodPlanId],
    }).onDelete('cascade'),
    index('day_meals_plan_idx').on(t.foodPlanId),
    index('day_meals_meal_idx').on(t.mealId, t.foodPlanId),
    index('day_meals_user_idx').on(t.userId),
  ],
)

// One food x amount, either in a (day, meal) cell (day_meal_id set, is_extra 0)
// or in Extras (day_meal_id null, is_extra 1) - the XOR check keeps those two
// facts in agreement. A cell entry is unique per (day_meal_id, food_item_id); an
// Extras entry is unique per (food_plan_id, food_item_id). basis picks the
// projection formula (design 5.1); amount is fractional (REAL) and > 0.
//
// Deliberate deviation from the old build: it had a BEFORE-INSERT trigger
// REJECTING a `packages` entry whose food has a null servings_per_package. We do
// NOT port that. Per design 5.4 such an entry is accepted and the projection
// flags itself incomplete - an incomplete projection is first-class, not an
// error. serving_weight_grams is NOT NULL > 0, so `servings`/`weight` bases are
// always projectable and need no cross-row guard.
//
// The composite FK on (day_meal_id, food_plan_id) is not enforced when
// day_meal_id is null (SQLite MATCH SIMPLE), which is exactly right for Extras.
// The 2000-per-plan cap trigger lives in migration 0008.
export const foodPlanEntries = sqliteTable(
  'food_plan_entries',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    foodPlanId: text('food_plan_id').notNull(),
    dayMealId: text('day_meal_id'), // null => Extras
    isExtra: integer('is_extra', { mode: 'boolean' }).notNull().default(false),
    foodItemId: text('food_item_id').notNull(),
    basis: text('basis', { enum: ['servings', 'packages', 'weight'] }).notNull(),
    amount: real('amount').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'food_plan_entries_plan_same_owner_fk',
      columns: [t.foodPlanId, t.userId],
      foreignColumns: [foodPlans.id, foodPlans.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'food_plan_entries_cell_same_plan_fk',
      columns: [t.dayMealId, t.foodPlanId],
      foreignColumns: [dayMeals.id, dayMeals.foodPlanId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'food_plan_entries_food_same_owner_fk',
      columns: [t.foodItemId, t.userId],
      foreignColumns: [foodItems.id, foodItems.userId],
    }).onDelete('cascade'),
    uniqueIndex('food_plan_entries_one_per_cell_idx')
      .on(t.dayMealId, t.foodItemId)
      .where(sql`${t.dayMealId} is not null`),
    uniqueIndex('food_plan_entries_one_per_extras_idx')
      .on(t.foodPlanId, t.foodItemId)
      .where(sql`${t.isExtra}`),
    index('food_plan_entries_plan_sort_idx').on(t.foodPlanId, t.sortOrder),
    index('food_plan_entries_food_idx').on(t.foodItemId, t.userId),
    index('food_plan_entries_user_idx').on(t.userId),
    check(
      'food_plan_entries_basis_enum',
      sql`${t.basis} in ('servings', 'packages', 'weight')`,
    ),
    check('food_plan_entries_amount_positive', sql`${t.amount} > 0`),
    check(
      'food_plan_entries_location_xor',
      sql`(${t.isExtra} and ${t.dayMealId} is null) or (not ${t.isExtra} and ${t.dayMealId} is not null)`,
    ),
  ],
)

// Packing checkmarks for the food checklist (food-planning-design.md 6).
// Keyed (list_id, food_item_id): ROW PRESENCE MEANS PACKED. There is no
// is_packed boolean - it would be true in every row that exists. Toggling
// is an insert or a delete, and the toggle is a compare-and-swap on the
// plan link the client observed (rule 3); the row's lifecycle is otherwise
// owned by the lists it hangs off: cleared when the list relinks (rule 1)
// and reconciled against the plan's remaining entries after structural
// mutations (rule 2). Never public - the share projection exposes only the
// derived weight, never checkmarks.
//
// No food_plan_id column, deliberately: packing is a property of the TRIP
// (the list), not the plan. Keying by plan was the old build's shape and
// is what made its pack state leak across trips.
export const foodPackState = sqliteTable(
  'food_pack_state',
  {
    listId: text('list_id').notNull(),
    foodItemId: text('food_item_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(), // epoch ms
  },
  (t) => [
    primaryKey({
      name: 'food_pack_state_pk',
      columns: [t.listId, t.foodItemId],
    }),
    // Composite same-owner FKs, both cascading (the list_items pattern):
    // deleting a list drops its checkmarks; deleting a food item drops its
    // checkmark from every list. Cross-owner stitching is structurally
    // impossible - a row can only cite a list and a food with its own
    // user_id.
    foreignKey({
      name: 'food_pack_state_list_same_owner_fk',
      columns: [t.listId, t.userId],
      foreignColumns: [lists.id, lists.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'food_pack_state_food_same_owner_fk',
      columns: [t.foodItemId, t.userId],
      foreignColumns: [foodItems.id, foodItems.userId],
    }).onDelete('cascade'),
    // The food-side cascade and rule 2's NOT IN scan both look up by food;
    // the PK already covers list-side lookups.
    index('food_pack_state_food_user_idx').on(t.foodItemId, t.userId),
  ],
)

// ------------------------------------------------- nutrition targets (slice 7)
//
// Three tables ported from the old build's 20260613200619/20260614050331
// migrations, with one deliberate tightening: `mode` has NO 'off' value
// ANYWHERE. The old plan tables permitted a stored mode='off' row (both bounds
// null) that the client never wrote; here "off" is simply the ABSENCE of the
// row, uniformly, and the bounds CHECK makes any other mode value
// unrepresentable. Bound magnitude mirrors the old numeric(12,4) (< 1e8); the
// 4-decimal-place scale rule is zod-only, like every other REAL column.
//
// No cap triggers: one-per-metric uniqueness bounds every table (6 rows/plan,
// 5 x meal-cap rows/plan, 6 rows/user).

const DAILY_TARGET_METRICS = [
  'calories',
  'protein',
  'carbs',
  'fiber',
  'sodium',
  'calorie_density',
] as const
const MEAL_TARGET_METRICS = [
  'calories',
  'protein',
  'fat_pct',
  'sugar_pct',
  'carb_protein_ratio',
] as const
const TARGET_MODES = ['range', 'min', 'max'] as const

// The mode/bounds consistency rule (old daily_target_bounds), shared by all
// three tables. Also the DB-level "no stored off": a mode outside
// range/min/max satisfies none of the branches.
const targetBoundsSql = (t: {
  mode: AnySQLiteColumn
  targetMin: AnySQLiteColumn
  targetMax: AnySQLiteColumn
}) => sql`
  (${t.targetMin} is null or (${t.targetMin} >= 0 and ${t.targetMin} < 100000000))
  and (${t.targetMax} is null or (${t.targetMax} >= 0 and ${t.targetMax} < 100000000))
  and ((${t.mode} = 'min' and ${t.targetMin} is not null and ${t.targetMax} is null)
    or (${t.mode} = 'max' and ${t.targetMax} is not null and ${t.targetMin} is null)
    or (${t.mode} = 'range' and ${t.targetMin} is not null and ${t.targetMax} is not null
      and ${t.targetMin} <= ${t.targetMax}))`

// Per-plan daily targets: at most one row per (plan, metric).
export const foodPlanDailyTargets = sqliteTable(
  'food_plan_daily_targets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    foodPlanId: text('food_plan_id').notNull(),
    metric: text('metric', { enum: DAILY_TARGET_METRICS }).notNull(),
    mode: text('mode', { enum: TARGET_MODES }).notNull(),
    targetMin: real('target_min'),
    targetMax: real('target_max'),
    createdAt: integer('created_at').notNull(), // epoch ms
    updatedAt: integer('updated_at').notNull(), // epoch ms
  },
  (t) => [
    unique('daily_target_one_per_metric').on(t.foodPlanId, t.metric),
    foreignKey({
      name: 'food_plan_daily_targets_plan_same_owner_fk',
      columns: [t.foodPlanId, t.userId],
      foreignColumns: [foodPlans.id, foodPlans.userId],
    }).onDelete('cascade'),
    index('food_plan_daily_targets_user_idx').on(t.userId),
    check(
      'food_plan_daily_targets_metric_enum',
      sql`${t.metric} in ('calories', 'protein', 'carbs', 'fiber', 'sodium', 'calorie_density')`,
    ),
    check('daily_target_bounds', targetBoundsSql(t)),
  ],
)

// Per-meal targets: at most one row per (meal, metric). Doubly pinned - the
// same-owner FK ties the row to the plan's owner, the (meal_id, food_plan_id)
// FK forbids citing another plan's meal (the day_meals stitching pattern).
export const mealTargets = sqliteTable(
  'meal_targets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    foodPlanId: text('food_plan_id').notNull(),
    mealId: text('meal_id').notNull(),
    metric: text('metric', { enum: MEAL_TARGET_METRICS }).notNull(),
    mode: text('mode', { enum: TARGET_MODES }).notNull(),
    targetMin: real('target_min'),
    targetMax: real('target_max'),
    createdAt: integer('created_at').notNull(), // epoch ms
    updatedAt: integer('updated_at').notNull(), // epoch ms
  },
  (t) => [
    unique('meal_target_one_per_metric').on(t.mealId, t.metric),
    foreignKey({
      name: 'meal_targets_plan_same_owner_fk',
      columns: [t.foodPlanId, t.userId],
      foreignColumns: [foodPlans.id, foodPlans.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'meal_targets_meal_same_plan_fk',
      columns: [t.mealId, t.foodPlanId],
      foreignColumns: [meals.id, meals.foodPlanId],
    }).onDelete('cascade'),
    // The save path deletes by plan; the one-per-metric unique leads with
    // meal_id and cannot serve that scan.
    index('meal_targets_plan_idx').on(t.foodPlanId),
    index('meal_targets_user_idx').on(t.userId),
    check(
      'meal_targets_metric_enum',
      sql`${t.metric} in ('calories', 'protein', 'fat_pct', 'sugar_pct', 'carb_protein_ratio')`,
    ),
    check('meal_target_bounds', targetBoundsSql(t)),
    // Percent metrics cap at 100 (old meal_target_pct_ceiling).
    check(
      'meal_target_pct_ceiling',
      sql`${t.metric} not in ('fat_pct', 'sugar_pct')
        or ((${t.targetMin} is null or ${t.targetMin} <= 100)
          and (${t.targetMax} is null or ${t.targetMax} <= 100))`,
    ),
  ],
)

// Account-level default daily targets (Settings). Copied BY VALUE into
// food_plan_daily_targets when a plan is created - no linkage, so later
// default edits never rewrite existing plans (the old build's invariant I1).
// Daily metric set only; meal defaults were never a thing.
export const foodPlanTargetDefaults = sqliteTable(
  'food_plan_target_defaults',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    metric: text('metric', { enum: DAILY_TARGET_METRICS }).notNull(),
    mode: text('mode', { enum: TARGET_MODES }).notNull(),
    targetMin: real('target_min'),
    targetMax: real('target_max'),
    createdAt: integer('created_at').notNull(), // epoch ms
    updatedAt: integer('updated_at').notNull(), // epoch ms
  },
  (t) => [
    unique('default_target_one_per_metric').on(t.userId, t.metric),
    check(
      'food_plan_target_defaults_metric_enum',
      sql`${t.metric} in ('calories', 'protein', 'carbs', 'fiber', 'sodium', 'calorie_density')`,
    ),
    check('default_target_bounds', targetBoundsSql(t)),
  ],
)
