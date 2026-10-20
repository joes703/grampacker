import { getTableColumns, type Table } from 'drizzle-orm'

// SQLite's limit on bound parameters in one statement, for the better-sqlite3
// build the app ships (pinned by server/db/sqlite.test.ts).
export const SQLITE_MAX_PARAMS = 32766

// How many parameters one chunked INSERT may bind: a quarter of the limit.
// The margin covers the row-width estimate below being wrong by a few columns,
// and a future SQLite build with a lower limit failing in tests rather than
// in production. It costs little: the largest write in the app needs about
// ten statements at this budget.
export const PARAM_BUDGET_PER_STATEMENT = Math.floor(SQLITE_MAX_PARAMS / 4)

// Rows per multi-row INSERT into `table`: the budget divided by the TABLE's
// column count, not the row literal's key count. Table width is a
// conservative UPPER BOUND on what drizzle 0.45 actually binds: an omitted
// column with a JS default still becomes a parameter, while SQL defaults and
// missing non-defaulted columns render inline and generated columns are
// skipped - so counting the table can only over-split, never blow the limit.
// Counting row KEYS could blow it: a literal that forgets one JS-defaulted
// column reports fewer keys than drizzle binds. One caveat keeps the bound
// honest: a cell holding a multi-parameter sql`` expression would cost more
// than one parameter - none of the callers does that.
function rowsPerStatement(table: Table): number {
  const columns = Object.keys(getTableColumns(table)).length
  return Math.max(1, Math.floor(PARAM_BUDGET_PER_STATEMENT / columns))
}

// Splits rows for multi-row INSERTs so no statement binds more than
// PARAM_BUDGET_PER_STATEMENT parameters. Its one caller is list duplication
// (server/repos/lists.ts), whose food associations alone can reach 18000
// rows - 72000 parameters, over SQLite's limit. Every chunk runs inside the
// caller's transaction. Empty input -> no statements.
export function chunkForParamCap<T extends Record<string, unknown>>(
  table: Table,
  rows: T[],
): T[][] {
  const perStatement = rowsPerStatement(table)
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += perStatement) {
    out.push(rows.slice(i, i + perStatement))
  }
  return out
}
