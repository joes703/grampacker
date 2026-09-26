// @ts-check
// What a NEW migration may not contain. Used by check-migration-safety.mjs.

// Statements a new migration may not contain. Matched after comments are
// stripped, case-insensitively. DROP COLUMN / DROP INDEX / DROP TRIGGER are
// allowed: they do not rebuild the table (see AGENTS.md "Migrations" for when).
/** @type {Array<[RegExp, string]>} */
export const FORBIDDEN = [
  [/\bdrop\s+table\b/i, 'DROP TABLE (a rebuild, or a table other rows cascade from)'],
  [/\brename\b/i, 'RENAME (a rebuild step, and a rename has no window where both names work)'],
  [/__new_/i, "drizzle-kit's table-rebuild scratch table"],
  [/\bpragma\s+foreign_keys\b/i, 'PRAGMA foreign_keys (a no-op on D1; its presence means a rebuild)'],
  [/\bd1_migrations\b/i, "wrangler's migration ledger"],
  [/\bsqlite_(master|schema)\b/i, 'the SQLite schema table'],
]

/** @param {string} sql */
export const stripComments = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

/** @param {string} sql @returns {string[]} */
export const forbiddenIn = (sql) =>
  FORBIDDEN.filter(([pattern]) => pattern.test(stripComments(sql))).map(([, why]) => why)
