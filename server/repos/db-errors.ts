// Matchers for SQLite errors that repos convert into friendly results
// instead of 500s. better-sqlite3 throws a SqliteError whose `code` is the
// SQLite extended result code (SQLITE_CONSTRAINT_UNIQUE, ..._TRIGGER, ...),
// and Drizzle may wrap it in its own error with the SqliteError as `cause`.
// Match ONLY the root cause. The outer wrappers embed the query and its
// bound params, so matching any other link in the chain would let
// user-controlled text (an item literally named 'list cap exceeded')
// misclassify an unrelated failure (Codex finding, PR #14). The root
// message never embeds bound values, and the code is set by SQLite itself,
// so requiring a SQLITE_CONSTRAINT* code pins the failure class.

function rootError(err: unknown): { message: string; code: string } | null {
  let root: unknown = err
  while (root instanceof Error && root.cause instanceof Error) {
    root = root.cause
  }
  if (!(root instanceof Error)) return null
  const code = (root as { code?: unknown }).code
  return { message: root.message, code: typeof code === 'string' ? code : '' }
}

// Any constraint class: SQLITE_CONSTRAINT and every extended code.
function isConstraint(code: string): boolean {
  return code.startsWith('SQLITE_CONSTRAINT')
}

// A cap trigger's RAISE(ABORT, marker). Keep markers in lockstep with
// the trigger message text in migrations 0003/0004.
export function isTriggerAbort(err: unknown, marker: string): boolean {
  const root = rootError(err)
  return (
    root !== null &&
    root.message.includes(marker) &&
    root.code === 'SQLITE_CONSTRAINT_TRIGGER'
  )
}

// A UNIQUE index violation on a specific table.column (SQLite names the
// columns in the message: "UNIQUE constraint failed: lists.slug").
export function isUniqueViolation(err: unknown, column: string): boolean {
  const root = rootError(err)
  return (
    root !== null &&
    root.message.includes(`UNIQUE constraint failed: ${column}`) &&
    isConstraint(root.code)
  )
}

// The pack-rank unique indexes, and ONLY those: the cohort index and the
// Unassigned partial index on each packable table (app-schema.ts,
// list_items_pack_cohort_uq / list_items_pack_unassigned_uq and the
// list_food_items pair). SQLite names an index's columns in its message, so
// the match is on the exact text. The converted pack repos map this to the
// retryable 409; any other constraint failure stays a 500, because retrying
// cannot fix it.
const PACK_RANK_UNIQUE_MESSAGES = new Set(
  ['list_items', 'list_food_items'].flatMap((table) => [
    `UNIQUE constraint failed: ${table}.list_id, ${table}.packing_location_id, ${table}.pack_sort_order`,
    `UNIQUE constraint failed: ${table}.list_id, ${table}.pack_sort_order`,
  ]),
)

export function isPackRankUniqueViolation(err: unknown): boolean {
  const root = rootError(err)
  return (
    root !== null &&
    root.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    PACK_RANK_UNIQUE_MESSAGES.has(root.message)
  )
}

// Migration 0019's range triggers. Reachable only when a cohort has exhausted
// the rank space (its maximum is already PACK_RANK_MAX, so the `max + 1` every
// arrival computes would step past it).
//
// Import no longer plants a row at the maximum - it assigns dense pack ranks -
// so this should not be reachable through the API at all. It is classified
// anyway: "should not be reachable" is exactly the kind of claim that decays,
// and the alternative is a 500 for a condition we understand completely.
export function isPackRankRangeError(err: unknown): boolean {
  return isTriggerAbort(err, 'pack_sort_order out of range')
}
