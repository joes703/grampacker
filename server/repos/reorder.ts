import { and, eq, type SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Tx } from '../db'

// The one owned-set reorder, shared by the five ordered collections
// (categories, gear, lists, list items, packing locations). All-or-nothing:
// every id must be in the owned set (ids are deduped by the DTOs) or nothing
// is written. Owned-set membership in JS rather than inArray over the input:
// one query whatever the input size, bounded by each collection's row cap.
//
// `scope` is the ownership predicate set - always the caller's userId, plus
// listId for list-nested rows - and it bounds BOTH the owned-set read and
// every UPDATE, so a row that leaves the scope between plan and write (it
// cannot, inside the caller's immediate transaction, but the WHERE does not
// rely on that) is simply not updated. Callers run this inside
// db.transaction(..., { behavior: 'immediate' }).
//
// An earlier comment said a generic helper "costs more in drizzle type
// gymnastics than the dozen duplicated lines are worth"; drizzle 0.45 types
// this signature cleanly, so that reason expired.
export function reorderOwnedSet(
  tx: Tx,
  table: SQLiteTable,
  cols: { id: SQLiteColumn; sortOrder: SQLiteColumn },
  scope: SQL[],
  updates: { id: string; sortOrder: number }[],
): boolean {
  const owned = new Set(
    tx
      .select({ id: cols.id })
      .from(table)
      .where(and(...scope))
      .all()
      .map((r) => r.id),
  )
  if (!updates.every((u) => owned.has(u.id))) return false
  for (const u of updates) {
    tx.update(table)
      .set({ sortOrder: u.sortOrder })
      .where(and(eq(cols.id, u.id), ...scope))
      .run()
  }
  return true
}
