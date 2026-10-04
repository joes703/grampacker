import { describe, expect, it } from 'vitest'
import { journalProblem, main } from './check-migration-immutability.mjs'

const SHA = 'a'.repeat(40)
const JOURNAL = 'migrations/meta/_journal.json'

// `git diff --name-only -z` output: every path NUL-terminated.
const z = (...paths: string[]) => Buffer.from(paths.map((p) => `${p}\0`).join(''))

const journal = (...tags: string[]) =>
  JSON.stringify({
    version: '7',
    dialect: 'sqlite',
    entries: tags.map((tag, idx) => ({ idx, version: '6', when: 1000 + idx, tag, breakpoints: true })),
  })

type Git = (args: string[]) => Buffer

/**
 * A git stub. `diff` returns `changed`; `show` returns the journal texts, and
 * throws if the test did not supply them (which proves it was not called).
 */
const gitWith = (changed: Buffer, journals?: { base: string; head: string }): Git => {
  return (args) => {
    if (args[0] === 'merge-base') return Buffer.from(`${SHA}\n`)
    if (args[0] === 'diff') {
      expect(args).toEqual([
        'diff',
        '--no-renames',
        '--name-only',
        '-z',
        '--diff-filter=a',
        SHA,
        'HEAD',
        '--',
        'migrations/',
      ])
      return changed
    }
    if (args[0] === 'show' && journals) {
      if (args[1] === `${SHA}:${JOURNAL}`) return Buffer.from(journals.base)
      if (args[1] === `HEAD:${JOURNAL}`) return Buffer.from(journals.head)
    }
    throw new Error(`unexpected git ${args.join(' ')}`)
  }
}

const run = (git: Git, eventName: string | undefined = 'pull_request', argv: string[] = []) => {
  const lines: string[] = []
  const code = main({ argv, eventName, git, log: (line) => lines.push(line) })
  return { code, output: lines.join('\n') }
}

describe('main', () => {
  it('permits a pull request that only adds files (additions never reach the diff)', () => {
    // --diff-filter=a excludes additions, so an added migration and its
    // snapshot produce no output at all.
    const { code, output } = run(gitWith(Buffer.alloc(0)))
    expect(code).toBe(0)
    expect(output).toMatch(/OK/)
  })

  it('refuses any historical path the diff reports', () => {
    // Modification, deletion, type change, mode change, a rename-away (which
    // --no-renames surfaces as the old path) and a changed snapshot all arrive
    // here identically - as a path that is not an addition - so one case
    // covers them and the git flags asserted in `gitWith` are what makes that
    // true. The whitespace path also proves NUL splitting survives to the
    // message. The baseline is here because nothing exempts it: swapping it
    // for another "baseline" could carry a schema change.
    for (const path of [
      'migrations/0000_baseline.sql',
      'migrations/meta/0000_snapshot.json',
      'migrations/00 27 a.sql',
    ]) {
      const { code, output } = run(gitWith(z(path)))
      expect(code, path).toBe(1)
      expect(output, path).toContain('REFUSED')
      expect(output, path).toContain(`  ${path}\n`)
    }
  })

  it('permits a journal that only gained entries', () => {
    const git = gitWith(z(JOURNAL), { base: journal('0027_a'), head: journal('0027_a', '0028_b') })
    expect(run(git).code).toBe(0)
  })

  it('refuses a rewritten journal', () => {
    const base = journal('0027_a', '0028_b')
    const rewrites: Array<[string, string]> = [
      ['an existing tag changed', journal('0027_x', '0028_b')],
      ['entries were reordered', journal('0028_b', '0027_a')],
      ['an entry was removed', journal('0027_a')],
      ['a non-entries field changed', JSON.stringify({ ...JSON.parse(base), version: '8' })],
      ['it does not parse', '{'],
    ]
    for (const [name, head] of rewrites) {
      const { code, output } = run(gitWith(z(JOURNAL), { base, head }))
      expect(code, name).toBe(1)
      expect(output, name).toContain('changed beyond appending')
    }
  })

  it('does not read the journal when the journal did not change', () => {
    // No journals supplied: the stub throws if `git show` is called at all.
    expect(run(gitWith(Buffer.alloc(0))).code).toBe(0)
  })

  it('fails closed when git evidence cannot be obtained', () => {
    const throwing: Git = () => {
      throw new Error('fatal: Not a valid object name origin/main')
    }
    const { code, output } = run(throwing)
    expect(code).toBe(1)
    expect(output).toContain('CANNOT BE CHECKED')

    // The journal is in the diff but unreadable: also fails closed.
    const unreadable = run(gitWith(z(JOURNAL)))
    expect(unreadable.code).toBe(1)
    expect(unreadable.output).toContain('CANNOT BE CHECKED')
  })

  it('skips without touching git off pull_request', () => {
    const git: Git = () => {
      throw new Error('should not be called')
    }
    for (const event of ['push', 'merge_group']) {
      const { code, output } = run(git, event)
      expect(code, event).toBe(0)
      expect(output).toContain('skipped')
    }

    // An explicit `undefined` would hit `run`'s default parameter, so this one
    // goes straight to main: an unset GITHUB_EVENT_NAME (running it by hand)
    // must skip, not fail.
    const lines: string[] = []
    expect(main({ argv: [], eventName: undefined, git, log: (line) => lines.push(line) })).toBe(0)
    expect(lines.join('\n')).toContain('skipped')
  })

  it('exits 1 on any argument, before touching git', () => {
    // The exit code alone cannot tell the argument check from a git failure:
    // both fail closed with 1. The message and the untouched git stub can.
    const calls: string[][] = []
    const git: Git = (args) => {
      calls.push(args)
      throw new Error('should not be called')
    }
    const { code, output } = run(git, 'pull_request', ['--dry-run'])
    expect(code).toBe(1)
    expect(output).toContain('takes no arguments (got: --dry-run)')
    expect(calls).toEqual([])
  })
})

describe('journalProblem', () => {
  it('accepts an unchanged journal and any pure append', () => {
    const base = journal('0027_a')
    expect(journalProblem(base, base)).toBeNull()
    expect(journalProblem(base, journal('0027_a', '0028_b', '0029_c'))).toBeNull()
  })

  it('does not judge what the appended entries say - the harness does that', () => {
    // A tag naming no .sql file is the harness's failure to report, not this
    // guard's. Keeping the rule in one place is the point.
    expect(journalProblem(journal('0027_a'), journal('0027_a', 'nonexistent'))).toBeNull()
  })
})
