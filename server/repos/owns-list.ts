import { and, eq } from 'drizzle-orm'
import { lists } from '../db/schema'
import type { Tx } from '../db'

// The ownership precheck for every list-nested write, in one place because
// it is the most security-relevant predicate in the repo layer. The route's
// list id is the only authority on which list a nested resource belongs to:
// a child id alone, even one of this user's own, must never widen access to
// another list's rows. Callers run it inside the same immediate transaction
// as their writes, so the answer still holds when the write runs.
export function ownsList(tx: Tx, userId: string, listId: string): boolean {
  const row = tx
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .limit(1)
    .get()
  return row !== undefined
}
