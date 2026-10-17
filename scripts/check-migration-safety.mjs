#!/usr/bin/env node
// @ts-check
// Checks the migrations directory before a migration can merge.
//
//   1. Bookkeeping: every journal entry has its .sql, every .sql has a journal
//      entry, and the newest entry has a snapshot. drizzle-kit writes all three
//      together, so a gap means a hand-edited migration.
//   2. The newest snapshot matches server/db/schema.ts: `drizzle-kit generate`
//      against a copy of meta/ must find nothing to do.
//   3. Migrations this branch adds (not in the merge base with origin/main)
//      contain none of the statements that can destroy production data. A
//      table rebuild's DROP TABLE can fire every ON DELETE CASCADE child. That
//      is how 0009 wiped list_items (docs/incidents.md).
//
// Everything else - including whether the SQL runs on SQLite - is proven by
// the API suite, which builds its database from this directory.
//
// Usage: node scripts/check-migration-safety.mjs. Needs origin/main fetched.

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { forbiddenIn } from './migration-rules.mjs'

const DIR = 'migrations'
const NO_CHANGES_MARKER = 'No schema changes, nothing to migrate'

/** @param {string[]} args */
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

/** @param {unknown} error */
const describe = (error) => (error instanceof Error ? error.message : String(error))

const checkBookkeeping = () => {
  /** @type {{ entries: Array<{ idx: number, tag: string }> }} */
  const journal = JSON.parse(readFileSync(join(DIR, 'meta', '_journal.json'), 'utf8'))
  const tags = journal.entries.map((entry) => entry.tag)
  const files = readdirSync(DIR).filter((name) => name.endsWith('.sql'))
  const problems = [
    ...tags.filter((tag) => !files.includes(`${tag}.sql`)).map((tag) => `journal entry ${tag} has no ${tag}.sql`),
    ...files.filter((file) => !tags.includes(file.slice(0, -4))).map((file) => `${file} has no journal entry`),
  ]
  const newest = journal.entries.at(-1)
  if (newest) {
    const snapshot = `${String(newest.idx).padStart(4, '0')}_snapshot.json`
    if (!existsSync(join(DIR, 'meta', snapshot))) problems.push(`newest entry ${newest.tag} has no meta/${snapshot}`)
  }
  if (problems.length > 0) {
    throw new Error(
      `Drizzle bookkeeping is broken:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
        'Create migrations with `drizzle-kit generate` (or `generate --custom`), never by hand.',
    )
  }
  console.log(`OK: ${tags.length} journal entries, each with its .sql; newest has its snapshot.`)
}

const checkSnapshotMatchesSchema = () => {
  // Inside the repo and relative: drizzle-kit prefixes --out with './', so an
  // absolute temp path breaks.
  const probeDir = `.snapshot-probe-${process.pid}`
  try {
    rmSync(probeDir, { recursive: true, force: true })
    cpSync(join(DIR, 'meta'), join(probeDir, 'meta'), { recursive: true })
    // drizzle-kit can print an error and still exit 0, so success is the
    // marker in its output, not the exit code.
    const probe = spawnSync(
      'npx',
      ['drizzle-kit', 'generate', '--dialect', 'sqlite', '--schema', './server/db/schema.ts', '--out', probeDir, '--name', 'probe'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const output = [probe.stdout, probe.stderr].filter(Boolean).join('\n').trim()
    const emitted = existsSync(probeDir) ? readdirSync(probeDir).filter((name) => name.endsWith('.sql')) : []
    if (probe.status !== 0 || emitted.length > 0 || !output.includes(NO_CHANGES_MARKER)) {
      throw new Error(
        'The newest snapshot does not match server/db/schema.ts (or drizzle-kit failed). ' +
          `Run \`npx drizzle-kit generate\`.\n${output}`,
      )
    }
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
  console.log('OK: newest snapshot matches server/db/schema.ts.')
}

const checkNewMigrations = () => {
  let base
  try {
    base = git(['merge-base', 'HEAD', 'origin/main'])
  } catch (error) {
    throw new Error(`Cannot find the merge base with origin/main; run \`git fetch origin main\`.\n${describe(error)}`)
  }
  const shipped = new Set(git(['ls-tree', '--name-only', `${base}:${DIR}`]).split('\n'))
  const pending = readdirSync(DIR).filter((name) => name.endsWith('.sql') && !shipped.has(name))
  const refused = pending
    .map((name) => /** @type {[string, string[]]} */ ([name, forbiddenIn(readFileSync(join(DIR, name), 'utf8'))]))
    .filter(([, reasons]) => reasons.length > 0)
  if (refused.length > 0) {
    throw new Error(
      'New migration(s) contain statements that can destroy production data:\n' +
        refused.map(([name, reasons]) => `  ${name}: ${reasons.join('; ')}`).join('\n') +
        '\nSee AGENTS.md "Migrations".',
    )
  }
  console.log(`OK: ${pending.length} new migration(s), none rebuilds, renames, or drops a table.`)
}

const main = () => {
  checkBookkeeping()
  checkSnapshotMatchesSchema()
  checkNewMigrations()
}

// Unconditional: a "run only when invoked directly" guard could silently turn
// this CI gate into a no-op. The testable rules live in migration-rules.mjs.
try {
  main()
} catch (error) {
  console.error(`\n${describe(error)}`)
  process.exit(1)
}
