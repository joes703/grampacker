// @ts-check
// What a NEW migration may not contain. Used by check-migration-safety.mjs.
// DROP COLUMN / DROP INDEX / DROP TRIGGER are allowed: they do not rebuild the
// table (see AGENTS.md "Migrations" for when).
//
// Matched against the RAW file - comments and strings included. Nothing is
// stripped first, because every attempt to strip comments while respecting
// SQL quoting left a way to hide a statement. A harmless migration that merely
// mentions one of these (say, in a comment) is refused; reword it.

// Between two keywords SQLite allows whitespace AND comments.
const GAP = String.raw`(?:\s|/\*[\s\S]*?\*/|--[^\n]*(?:\n|$))+`
/** @param {string} source */
const rx = (source) => new RegExp(source, 'i')

/** @type {Array<[RegExp, string]>} */
const FORBIDDEN = [
  [rx(String.raw`\bdrop${GAP}table\b`), 'DROP TABLE (a rebuild, or a table other rows cascade from)'],
  [
    rx(String.raw`\balter${GAP}table\b[\s\S]*\brename\b`),
    'ALTER TABLE ... RENAME (a rebuild step, and a rename has no window where both names work)',
  ],
  [/__new_/i, "drizzle-kit's table-rebuild scratch table"],
  [/\bforeign_keys\b/i, 'PRAGMA foreign_keys (its presence usually means a rebuild)'],
  [/\b__drizzle_migrations\b/i, "the application's migration ledger"],
  [/\bsqlite_(master|schema)\b/i, 'the SQLite schema table'],
]

/** @param {string} sql @returns {string[]} */
export const forbiddenIn = (sql) =>
  FORBIDDEN.filter(([pattern]) => pattern.test(sql)).map(([, why]) => why)
