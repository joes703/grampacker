import { and, eq } from 'drizzle-orm'
import { categories, gearItems, lists } from '../db/schema'
import type { Tx } from '../db'

// The ownership predicates for writes that take a client-supplied id, in one
// place because they are the most security-relevant checks in the repo
// layer: the repositories are the authorization boundary (AGENTS.md
// Invariants). Each takes the transaction and the session's user id
// explicitly, and callers run it inside the same immediate transaction as
// their writes, so the answer still holds when the write runs.

// The precheck for every list-nested write. The route's list id is the only
// authority on which list a nested resource belongs to: a child id alone,
// even one of this user's own, must never widen access to another list's
// rows.
export function ownsList(tx: Tx, userId: string, listId: string): boolean {
  const row = tx
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .limit(1)
    .get()
  return row !== undefined
}

export function ownsCategory(tx: Tx, userId: string, categoryId: string): boolean {
  const row = tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1)
    .get()
  return row !== undefined
}

// The whole owned set, for checking many client ids at once: membership in
// JS is one query whatever the input size, where an inArray over the input
// would bind one parameter per id (docs/server.md "SQL and Drizzle"). The category and gear
// caps bound each scan at 500 rows.
export function ownedCategoryIds(tx: Tx, userId: string): Set<string> {
  return new Set(
    tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.userId, userId))
      .all()
      .map((r) => r.id),
  )
}

export function ownedGearIds(tx: Tx, userId: string): Set<string> {
  return new Set(
    tx
      .select({ id: gearItems.id })
      .from(gearItems)
      .where(eq(gearItems.userId, userId))
      .all()
      .map((r) => r.id),
  )
}
