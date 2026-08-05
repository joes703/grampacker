import { getTableColumns, type Table } from 'drizzle-orm'

// D1 allows at most 100 bound parameters per query
// (https://developers.cloudflare.com/d1/platform/limits/), and drizzle's
// inArray binds one parameter per id. Any statement carrying a DTO-sized
// id list (300-500 ids across this repo's bulk endpoints) must be split.
// 90 leaves headroom for the other bound values in the same statement
// (userId, timestamps, etc.). Chunked writes MUST go through db.batch so
// the split stays one transaction.
//
// Ownership PREchecks should not use this: select ALL of the user's owned
// ids with the single userId parameter and test membership in a JS Set
// instead (see ownsAllGearIds) - one query regardless of input size.
export const MAX_IDS_PER_STATEMENT = 90

export function chunkIds<T>(ids: T[], size = MAX_IDS_PER_STATEMENT): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size))
  }
  return chunks
}

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
// than one param - none of the callers does that. 90 for the same headroom
// as chunkIds above. Empty input -> no statements.
//
// Lived in the food plan-copy repo until food planning was removed; it was
// never food-specific, and list duplication has always depended on it.
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
