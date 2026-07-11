import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'
import { session, user } from './auth-schema'

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

// DEAD TABLE. Nothing reads or writes it: sudo mode is now session freshness
// (better-auth's session.freshAge - see server/middleware/fresh-auth.ts), and
// the repo, the endpoint and the DTO that fed this are gone.
//
// It is still DECLARED because the table still EXISTS in production. Deleting
// the declaration without a migration would put the Drizzle schema out of step
// with the deployed database, and CI applies migrations before it deploys the
// Worker - so the drop has to be its own change, shipped after this one is live
// (docs/passwordless-auth-design.md section 9, PR 3). Do not write to it.
//
// It could not have survived the passwordless cutover in any case: the old
// freshness check inner-joined the `credential` account row to compare the proof
// against the password's updated_at. With no credential row, that join matches
// nothing and the gate fails closed - locking every user out of passkey
// management. The mechanism died with the password, not by choice.
export const freshAuth = sqliteTable(
  'fresh_auth',
  {
    sessionId: text('session_id')
      .primaryKey()
      .references(() => session.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(), // epoch ms
    grantedAt: integer('granted_at').notNull(), // epoch ms
  },
  (t) => [index('fresh_auth_user_idx').on(t.userId)],
)

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
