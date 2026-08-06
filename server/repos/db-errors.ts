// Matchers for SQLite errors that repos convert into friendly results
// instead of 500s. The error text arrives wrapped (DrizzleQueryError ->
// D1_ERROR -> the SQLite message); match ONLY the root cause. The outer
// wrappers embed bound params, so matching any other link in the chain
// would let user-controlled text (an item literally named 'list cap
// exceeded') misclassify an unrelated failure (Codex finding, PR #14).
// The raw SQLite message never embeds values, and requiring the
// SQLITE_CONSTRAINT_* marker pins the failure class.

function rootMessage(err: unknown): string | null {
  let root: unknown = err
  while (root instanceof Error && root.cause instanceof Error) {
    root = root.cause
  }
  return root instanceof Error ? root.message : null
}

// A cap trigger's RAISE(ABORT, marker). Keep markers in lockstep with
// the trigger message text in migrations 0003/0004.
export function isTriggerAbort(err: unknown, marker: string): boolean {
  const msg = rootMessage(err)
  return (
    msg !== null &&
    msg.includes(marker) &&
    msg.includes('SQLITE_CONSTRAINT_TRIGGER')
  )
}

// A UNIQUE index violation on a specific table.column (SQLite names the
// columns in the message: "UNIQUE constraint failed: lists.slug").
export function isUniqueViolation(err: unknown, column: string): boolean {
  const msg = rootMessage(err)
  return (
    msg !== null &&
    msg.includes(`UNIQUE constraint failed: ${column}`) &&
    msg.includes('SQLITE_CONSTRAINT')
  )
}

// A UNIQUE violation on ANY column - used where a repo prechecks a duplicate but
// wants the DB's own unique index as the race backstop, and a composite/partial
// index names several columns so a single-column match is impractical. The
// class marker check is the bare SQLITE_CONSTRAINT prefix - a SUBSTRING of
// every extended code (D1's real messages carry the extended
// SQLITE_CONSTRAINT_UNIQUE, which this matches) - because the message text
// "UNIQUE constraint failed" already names the class and the marker only has
// to rule out non-constraint errors.
export function isAnyUniqueViolation(err: unknown): boolean {
  const msg = rootMessage(err)
  return (
    msg !== null &&
    msg.includes('UNIQUE constraint failed') &&
    msg.includes('SQLITE_CONSTRAINT')
  )
}

// A FOREIGN KEY violation. Used as the race backstop where a repo prechecks a
// referenced row's ownership/existence but that row can be deleted between the
// precheck and the insert - the FK then fires instead of a clean result.
export function isForeignKeyViolation(err: unknown): boolean {
  const msg = rootMessage(err)
  return (
    msg !== null &&
    msg.includes('FOREIGN KEY constraint failed') &&
    msg.includes('SQLITE_CONSTRAINT')
  )
}

// The reorder guard firing. `reorderPack` aborts its batch by feeding NULL into
// `_pack_reorder_guard.ok` (NOT NULL) when a park did not land, which is how a
// lost race becomes a 409 instead of a silent no-op that returns 204.
//
// Pinned to the guard's own column so an unrelated NOT NULL failure elsewhere
// in the batch is not misread as a lost race. The class marker is the bare
// SQLITE_CONSTRAINT prefix (a substring of the extended
// SQLITE_CONSTRAINT_NOTNULL that D1's real messages carry); the raw SQLite
// message never embeds bound values, so no user-controlled text can reach
// this match.
export function isPackGuardViolation(err: unknown): boolean {
  const msg = rootMessage(err)
  return (
    msg !== null &&
    msg.includes('NOT NULL constraint failed: _pack_reorder_guard.ok') &&
    msg.includes('SQLITE_CONSTRAINT')
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
