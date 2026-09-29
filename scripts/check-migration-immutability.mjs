#!/usr/bin/env node
// @ts-check
// Refuses a pull request that changes a migration file `main` already holds.
// Production applies migrations BY NAME and never re-runs one, so an edited
// migration would describe a schema production does not have.
//
// Judged against the merge base with origin/main, so a migration the pull
// request itself adds can change freely across pushes.
//
// No exceptions. Collapsing history into a new baseline deletes shipped files,
// so it is refused here and needs its own reviewed, single-use exception
// (docs/testing-and-ci.md section 7). The 2026-09-26 collapse carried one; it
// was removed once that collapse had merged, since it could never fire again.
//
// Runs on pull_request only. The "Protect main" ruleset makes a pull request
// the only route to main; a direct push would not be checked.
//
// Usage: node scripts/check-migration-immutability.mjs
//
// Takes no arguments, so there is no flag that could turn a run into a no-op.

import { execFileSync } from 'node:child_process'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const JOURNAL = 'migrations/meta/_journal.json'

/** @param {unknown} error */
const describe = (error) => (error instanceof Error ? error.message : String(error))

/**
 * Whether a changed journal did nothing but gain entries. drizzle-kit appends
 * to `entries` and touches nothing else, so every existing entry must be an
 * unchanged prefix and every other field must be identical. What the appended
 * entries SAY is not checked here: check-migration-safety.mjs's bookkeeping
 * check holds them to the .sql files and snapshots.
 * @param {string} baseText
 * @param {string} headText
 * @returns {string | null} a reason, or null when the change is append-only
 */
export const journalProblem = (baseText, headText) => {
  /** @param {string} text @returns {{ entries: unknown[], rest: string }} */
  const load = (text) => {
    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.entries)) {
      throw new Error('not an object with an entries array')
    }
    const { entries, ...rest } = parsed
    return { entries, rest: JSON.stringify(rest) }
  }
  let base
  let head
  try {
    base = load(baseText)
    head = load(headText)
  } catch (error) {
    return `it did not parse: ${describe(error)}`
  }
  if (base.rest !== head.rest) return 'a field other than entries changed'
  if (head.entries.length < base.entries.length) return 'entries were removed'
  for (let i = 0; i < base.entries.length; i += 1) {
    if (JSON.stringify(base.entries[i]) !== JSON.stringify(head.entries[i])) {
      return `existing entry ${i} changed`
    }
  }
  return null
}

/**
 * @param {{
 *   argv: string[],
 *   eventName: string | undefined,
 *   git: (args: string[]) => Buffer,
 *   log: (line: string) => void,
 * }} deps
 * @returns {number} the exit code
 */
export const main = ({ argv, eventName, git, log }) => {
  if (argv.length > 0) {
    log(`${basename(fileURLToPath(import.meta.url))} takes no arguments (got: ${argv.join(' ')})`)
    return 1
  }
  if (eventName !== 'pull_request') {
    log(`migration immutability: skipped (event is ${eventName ?? 'unset'}, not pull_request)`)
    return 0
  }

  // The diff is the ONLY evidence here, so failing to get it fails the step.
  // Passing on a missing merge base would turn the guard off exactly when the
  // checkout is misconfigured, which is when it is least likely to be noticed.
  let base
  let changed
  try {
    base = git(['merge-base', 'origin/main', 'HEAD']).toString('utf8').trim()
    // `--diff-filter=a` is LOWERCASE: it EXCLUDES additions, so a new
    // migration never reaches this list and "permit new migration files" needs
    // no code. `--no-renames` turns a rename into a delete plus an add, so a
    // rename-away arrives as a deletion of the old path and no two-path record
    // shape has to be parsed. `-z` makes the fields NUL-separated, so a path
    // containing a space, a tab or a newline is one field.
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

// Only when run as a program: the test imports this module.
const entry = process.argv[1]
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = main({
    argv: process.argv.slice(2),
    eventName: process.env.GITHUB_EVENT_NAME,
    git: (args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] }),
    log: console.log,
  })
}
