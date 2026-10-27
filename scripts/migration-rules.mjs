// @ts-check
// The testable migration rules behind check-migration-safety.mjs.
import { isDeepStrictEqual } from 'node:util'

/** @param {unknown} error */
export const describe = (error) => (error instanceof Error ? error.message : String(error))

// What a NEW migration may not contain.
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

const JOURNAL = 'migrations/meta/_journal.json'

/**
 * Whether a changed journal did nothing but gain entries. drizzle-kit appends
 * to `entries` and touches nothing else, so every existing entry must be an
 * unchanged prefix and every other field must be identical. What the appended
 * entries say is checked by the bookkeeping check, against the .sql files and
 * snapshots.
 * @param {string} baseText
 * @param {string} headText
 * @returns {string | null} a reason, or null when the change is append-only
 */
const journalProblem = (baseText, headText) => {
  /** @param {string} text @returns {{ entries: unknown[], rest: object }} */
  const load = (text) => {
    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.entries)) {
      throw new Error('not an object with an entries array')
    }
    const { entries, ...rest } = parsed
    return { entries, rest }
  }
  let base
  let head
  try {
    base = load(baseText)
    head = load(headText)
  } catch (error) {
    return `it did not parse: ${describe(error)}`
  }
  if (!isDeepStrictEqual(base.rest, head.rest)) return 'a field other than entries changed'
  if (head.entries.length < base.entries.length) return 'entries were removed'
  for (let i = 0; i < base.entries.length; i += 1) {
    if (!isDeepStrictEqual(base.entries[i], head.entries[i])) return `existing entry ${i} changed`
  }
  return null
}

/**
 * Refuses a change to a migration file `main` already holds. Production
 * applies migrations by name and never re-runs one, so an edited migration
 * would describe a schema production does not have. Judged against the merge
 * base with origin/main, so a migration the branch adds can change freely.
 * No exceptions: collapsing history into a new baseline needs its own
 * reviewed, single-use exception (docs/testing-and-ci.md section 7).
 *
 * CI runs this on pull requests only; the "Protect main" ruleset makes a pull
 * request the only route to main.
 * @param {{ git: (args: string[]) => Buffer, log: (line: string) => void }} deps
 * @returns {number} the exit code
 */
export const checkShippedUnchanged = ({ git, log }) => {
  // The diff is the only evidence, so failing to get it fails the check.
  // Passing on a missing merge base would turn the guard off exactly when the
  // checkout is misconfigured.
  let base
  let changed
  try {
    base = git(['merge-base', 'origin/main', 'HEAD']).toString('utf8').trim()
    // `--diff-filter=a` is lowercase: it EXCLUDES additions, so a new
    // migration never reaches this list. `--no-renames` turns a rename into a
    // delete plus an add, so a rename-away arrives as a deletion of the old
    // path. `-z` keeps a path with a space, tab or newline as one field.
    const out = git([
      'diff',
      '--no-renames',
      '--name-only',
      '-z',
      '--diff-filter=a',
      base,
      'HEAD',
      '--',
      'migrations/',
    ]).toString('utf8')
    changed = out === '' ? [] : out.split('\0').filter((path) => path !== '')
  } catch (error) {
    log(
      `migration immutability: CANNOT BE CHECKED - ${describe(error)}\n` +
        'A pull request is judged against its diff from origin/main. Fix the ' +
        'checkout (fetch-depth: 0) rather than the gate.',
    )
    return 1
  }

  const refused = changed.filter((path) => path !== JOURNAL)
  if (refused.length > 0) {
    log(
      `migration immutability: REFUSED - this pull request changes ${refused.length} ` +
        `migration file(s) that main already holds:\n${refused.map((p) => `  ${p}`).join('\n')}\n` +
        'Production applied these by name and will never re-run them; add a new ' +
        'migration instead (AGENTS.md).',
    )
    return 1
  }

  if (changed.includes(JOURNAL)) {
    let problem
    try {
      const before = git(['show', `${base}:${JOURNAL}`]).toString('utf8')
      const after = git(['show', `HEAD:${JOURNAL}`]).toString('utf8')
      problem = journalProblem(before, after)
    } catch (error) {
      log(`migration immutability: CANNOT BE CHECKED - ${JOURNAL} is unreadable: ${describe(error)}`)
      return 1
    }
    if (problem !== null) {
      log(
        `migration immutability: REFUSED - ${JOURNAL} changed beyond appending: ${problem}.\n` +
          'drizzle-kit only appends; a rewritten journal renames history that ' +
          'production has already applied.',
      )
      return 1
    }
  }

  log('migration immutability: OK (no migration main already holds was changed)')
  return 0
}
