import { drizzle } from 'drizzle-orm/d1'

// Portability rule 3: all DB access goes through this factory. On Workers it
// wraps the D1 binding; a Node deployment swaps in a better-sqlite3-backed
// drizzle instance behind the same call sites.
//
// Drizzle 1.0 dropped the v0 `{ schema }` config in favor of a `relations`
// config; that gets wired here when the first tables land (phase 1).
//
// Handlers must not call this directly once repositories exist (phase 1) -
// they receive user-scoped repositories instead, and an ESLint import
// boundary will enforce that.
export function createDb(d1: D1Database) {
  return drizzle(d1)
}

export type Db = ReturnType<typeof createDb>
