// @ts-check
// What a NEW migration may not contain. Used by check-migration-safety.mjs.
// DROP COLUMN / DROP INDEX / DROP TRIGGER are allowed: they do not rebuild the
// table (see AGENTS.md "Migrations" for when).

/** @type {Array<[RegExp, string]>} */
export const FORBIDDEN = [
  [/\bdrop\s+table\b/i, 'DROP TABLE (a rebuild, or a table other rows cascade from)'],
  [
    /\balter\s+table\s+(?:`[^`]*`|"[^"]*"|\[[^\]]*\]|\w+)\s+rename\b/i,
    'ALTER TABLE ... RENAME (a rebuild step, and a rename has no window where both names work)',
  ],
  [/__new_/i, "drizzle-kit's table-rebuild scratch table"],
  [/\bpragma\s+foreign_keys\b/i, 'PRAGMA foreign_keys (a no-op on D1; its presence means a rebuild)'],
  [/\bd1_migrations\b/i, "wrangler's migration ledger"],
  [/\bsqlite_(master|schema)\b/i, 'the SQLite schema table'],
]

/**
 * The SQL with comments removed and the CONTENTS of string literals replaced
 * by `x`, so neither can hide a statement or fake one. Quoted identifiers
 * ("", ``, []) are kept as written. Quote-aware: `'--'` is a string, not a
 * comment.
 * @param {string} sql
 */
export const codeOnly = (sql) => {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1
      out += ' '
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      out += ' '
    } else if (c === "'") {
      out += "'"
      i += 1
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += 'xx'
          i += 2
        } else if (sql[i] === "'") {
          break
        } else {
          out += 'x'
          i += 1
        }
      }
      out += "'"
      i += 1
    } else if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      const end = sql.indexOf(close, i + 1)
      const stop = end === -1 ? sql.length : end + 1
      out += sql.slice(i, stop)
      i = stop
    } else {
      out += c
      i += 1
    }
  }
  return out
}

/** @param {string} sql @returns {string[]} */
export const forbiddenIn = (sql) => {
  const code = codeOnly(sql)
  return FORBIDDEN.filter(([pattern]) => pattern.test(code)).map(([, why]) => why)
}
