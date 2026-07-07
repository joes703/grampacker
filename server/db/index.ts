import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

// Portability rule 3: all DB access goes through this factory. On Workers it
// wraps the D1 binding; a Node deployment swaps in a better-sqlite3-backed
// drizzle instance behind the same call sites.
//
// Drizzle is pinned to the 0.45.x stable line because better-auth's adapter
// peers on drizzle-orm ^0.45.2 (see STACK.md). Upgrade to 1.x when
// better-auth's peer range admits it.
//
// Handlers must not call this directly once repositories exist (phase 1) -
// they receive user-scoped repositories instead, and an ESLint import
// boundary will enforce that.
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema })
}

export type Db = ReturnType<typeof createDb>
