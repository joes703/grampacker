import { getTableColumns, type Table } from 'drizzle-orm'

// Splits rows for multi-row INSERTs so no statement binds too many
// parameters. Its one caller is list duplication (server/repos/lists.ts),
// whose food associations alone can reach 18000 rows - 72000 parameters,
// over SQLite's 32766 per statement. The budget of 90 per statement dates
// from D1's 100-parameter limit; it is far below SQLite's, which only costs
// more statements inside the same transaction.
//
// floor(90 / columns) rows per multi-row INSERT, where columns is the
// TABLE's column count, not the row literal's key count. Table width is a
// conservative UPPER BOUND on what drizzle 0.45 actually binds: an omitted
// column with a JS default still becomes a parameter, while SQL defaults
// and missing non-defaulted columns render inline and generated columns are
// skipped - so counting the table can only over-split, never blow the cap.
// Counting row KEYS could blow it: a literal that forgets one JS-defaulted
// column (listFoodItems is 9 wide; at 10 rows that is 90 params with ZERO
// margin) reports fewer keys than drizzle binds. One caveat keeps the bound
// honest: a cell holding a multi-parameter sql`` expression would cost more
// than one param - none of the callers does that. Empty input -> no
// statements.
export function chunkForParamCap<T extends Record<string, unknown>>(
  table: Table,
  rows: T[],
): T[][] {
  if (rows.length === 0) return []
  const columns = Object.keys(getTableColumns(table)).length
  const perStatement = Math.max(1, Math.floor(90 / columns))
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += perStatement) {
    out.push(rows.slice(i, i + perStatement))
  }
  return out
}
