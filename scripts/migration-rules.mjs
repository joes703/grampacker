// @ts-check
// What a NEW migration may not contain. Used by check-migration-safety.mjs.
// DROP COLUMN / DROP INDEX / DROP TRIGGER are allowed: they do not rebuild the
// table (see AGENTS.md "Migrations" for when).
//
// Matched against the RAW file - comments and strings included. Nothing is
// stripped first, because every attempt to strip comments while respecting
// SQL quoting left a way to hide a statement. A harmless migration that merely
// mentions one of these (say, in a comment) is refused; reword it.

/** @type {Array<[RegExp, string]>} */
export const FORBIDDEN = [
  [/\bdrop\s+table\b/i, 'DROP TABLE (a rebuild, or a table other rows cascade from)'],
  [
    /\balter\s+table\b[\s\S]*\brename\b/i,
    'ALTER TABLE ... RENAME (a rebuild step, and a rename has no window where both names work)',
  ],
  [/__new_/i, "drizzle-kit's table-rebuild scratch table"],
  [/\bforeign_keys\b/i, 'PRAGMA foreign_keys (a no-op on D1; its presence means a rebuild)'],
  [/\bd1_migrations\b/i, "wrangler's migration ledger"],
  [/\bsqlite_(master|schema)\b/i, 'the SQLite schema table'],
]

/** @param {string} sql @returns {string[]} */
export const forbiddenIn = (sql) =>
  FORBIDDEN.filter(([pattern]) => pattern.test(sql)).map(([, why]) => why)
