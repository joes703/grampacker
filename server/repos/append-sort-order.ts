import { sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

// The one way a new row appends to an ordered set: one past the current
// maximum, 0 for the first row. It runs as a subquery inside the INSERT,
// inside the caller's immediate transaction, so it cannot race another
// append on the same connection.
//
// Every `where` predicate must reference only `table`'s own columns:
// drizzle renders interpolated columns unqualified, so a predicate meant to
// correlate with an OUTER table would silently resolve against `table` and
// return plausible but wrong data (AGENTS.md "Traps"). The current callers
// all scope by their own table's userId, plus listId where rows nest.
// packing-locations keeps its hand-aliased raw SQL instead: it also needs
// the min - 1 prepend variant and documents the aliasing hazard in place.
export function appendSortOrder(
  table: SQLiteTable,
  column: SQLiteColumn,
  ...where: SQL[]
): SQL<number> {
  return sql`coalesce((select max(${column}) + 1 from ${table} where ${sql.join(where, sql` and `)}), 0)`
}
