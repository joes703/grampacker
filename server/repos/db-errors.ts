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
