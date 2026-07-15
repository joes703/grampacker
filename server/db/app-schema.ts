import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  unique,
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
    weightGrams: integer('weight_grams').notNull().default(0),
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
// the gear cap trigger.
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
    // (slice 2) and food_pack_state (slice 4). Adding this later would
    // force a table rebuild, which silently drops the cap trigger - so it
    // lands now even though nothing references it yet.
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
