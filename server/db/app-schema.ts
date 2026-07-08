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
// (drizzle has no trigger DSL); the repo pre-checks it for a friendly 422.
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
