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

// A UNIQUE violation on ANY column - used where a repo prechecks a duplicate but
// wants the DB's own unique index as the race backstop, and a composite/partial
// index names several columns so a single-column match is impractical. Any
// constraint code is accepted (SQLite reports SQLITE_CONSTRAINT_UNIQUE or
// SQLITE_CONSTRAINT_PRIMARYKEY here): the message text "UNIQUE constraint
// failed" already names the class, and the code only has to rule out
// non-constraint errors.
export function isAnyUniqueViolation(err: unknown): boolean {
  const root = rootError(err)
  return (
    root !== null &&
    root.message.includes('UNIQUE constraint failed') &&
    isConstraint(root.code)
  )
}

// A FOREIGN KEY violation. Used as the race backstop where a repo prechecks a
// referenced row's ownership/existence but that row can be deleted between the
// precheck and the insert - the FK then fires instead of a clean result.
export function isForeignKeyViolation(err: unknown): boolean {
  const root = rootError(err)
  return (
    root !== null &&
    root.message.includes('FOREIGN KEY constraint failed') &&
    isConstraint(root.code)
  )
}

// The reorder guard firing. `reorderPack` aborts its batch by feeding NULL into
// `_pack_reorder_guard.ok` (NOT NULL) when a park did not land, which is how a
// lost race becomes a 409 instead of a silent no-op that returns 204.
//
// Pinned to the guard's own column so an unrelated NOT NULL failure elsewhere
// in the batch is not misread as a lost race. Any constraint code is accepted
// (SQLite reports SQLITE_CONSTRAINT_NOTNULL); the root SQLite message never
// embeds bound values, so no user-controlled text can reach this match.
export function isPackGuardViolation(err: unknown): boolean {
  const root = rootError(err)
  return (
    root !== null &&
    root.message.includes('NOT NULL constraint failed: _pack_reorder_guard.ok') &&
    isConstraint(root.code)
  )
}

// A chunked park/settle statement matched a row by id but not by its
// expected rank: the SET subquery yielded NULL into the NOT NULL rank
// column. Per-row drift detection for the union reorder - the row moved
// between the pre-read and the batch, so the whole batch must roll back.
export function isPackRankNotNullViolation(err: unknown): boolean {
  const root = rootError(err)
  return (
    root !== null &&
    (root.message.includes('NOT NULL constraint failed: list_items.pack_sort_order') ||
      root.message.includes(
        'NOT NULL constraint failed: list_food_items.pack_sort_order',
      )) &&
    isConstraint(root.code)
  )
}

// The food half of the union reorder guard, 0022's mirror of the above.
export function isFoodPackGuardViolation(err: unknown): boolean {
  const root = rootError(err)
  return (
    root !== null &&
    root.message.includes('NOT NULL constraint failed: _food_pack_reorder_guard.ok') &&
    isConstraint(root.code)
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
