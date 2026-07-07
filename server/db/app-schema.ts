import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// App-owned tables. Auth tables live in auth-schema.ts (CLI-generated,
// never hand-edited); everything the app itself owns goes here.

// Fixed-window rate limit counters, one row per scope+client key
// (e.g. "sign-in:203.0.113.10"). Plain SQLite, written through a single
// atomic upsert in server/middleware/rate-limit.ts - portable to the
// Node+SQLite target unchanged.
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStart: integer('window_start').notNull(), // epoch ms
})
