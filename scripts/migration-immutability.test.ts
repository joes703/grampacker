import { describe, expect, it } from 'vitest'
import { checkShippedUnchanged } from './migration-rules.mjs'

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

const run = (git: Git) => {
  const lines: string[] = []
  const code = checkShippedUnchanged({ git, log: (line) => lines.push(line) })
  return { code, output: lines.join('\n') }
}

describe('checkShippedUnchanged', () => {
  it('permits a pull request that only adds files (additions never reach the diff)', () => {
    // --diff-filter=a excludes additions, so an added migration and its
    // snapshot produce no output at all. No journals are supplied, so the stub
    // also proves the journal is not read when it did not change.
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
    // Unchanged and a two-entry append, too: a rule that wants exactly one new
    // entry, or any new entry at all, refuses one of them.
    const base = journal('0027_a')
    for (const head of [base, journal('0027_a', '0028_b'), journal('0027_a', '0028_b', '0029_c')]) {
      const { code, output } = run(gitWith(z(JOURNAL), { base, head }))
      expect(code, head).toBe(0)
      expect(output, head).toMatch(/OK/)
    }
  })

  it('ignores key order inside an entry, which carries no meaning', () => {
    const base = journal('0027_a')
    const entry = JSON.parse(base).entries[0]
    const reordered = JSON.stringify({ ...JSON.parse(base), entries: [Object.fromEntries(Object.entries(entry).reverse())] })
    const { code, output } = run(gitWith(z(JOURNAL), { base, head: reordered }))
    expect(code).toBe(0)
    expect(output).toMatch(/OK/)
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
})
