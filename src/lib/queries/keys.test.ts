import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'
import { mutationKeys } from './keys'

describe('mutationKeys', () => {
  const keys = Object.entries(mutationKeys).map(([name, build]) => ({
    name,
    // Every factory takes at most one string argument; passing one to a
    // zero-arg factory is harmless and keeps this exhaustive without a
    // per-key table that could drift.
    key: (build as (arg: string) => readonly string[])('ARG') as readonly string[],
  }))

  it('has no key that is a prefix of another', () => {
    // Guards the loop against silently testing nothing.
    expect(keys.length).toBeGreaterThan(30)

    // TanStack Query matches mutation filters by PREFIX. use-list-item-actions
    // gates its last-one-out invalidation on isMutating({mutationKey}), so a key
    // that starts with another key's elements would silently join that burst
    // gate and suppress an invalidation - a stale-cache bug with no error
    // anywhere to find it by.
    const collisions: string[] = []
    for (const a of keys) {
      for (const b of keys) {
        if (a.name === b.name) continue
        const isPrefix = a.key.every((element, i) => b.key[i] === element)
        if (isPrefix) collisions.push(`${a.name} is a prefix of ${b.name}`)
      }
    }
    expect(collisions).toEqual([])
  })
})

// The gate that keeps the 39 call sites keyed. A green lint run proves nothing
// unless the rule itself bites, so this asserts it does - including the shapes
// that defeated the textual scan this replaced.
describe('the useMutation lint rule', () => {
  let eslint: ESLint

  // The first lint starts the type-aware TypeScript program, which takes
  // seconds and timed out the first test under load. Pay it once here, with
  // room to spare, so each test times only its own lint.
  beforeAll(async () => {
    eslint = new ESLint()
    await lint('const warm = 1')
  }, 60_000)

  async function lint(source: string): Promise<string[]> {
    // The fixture is attributed to keys.ts rather than an invented filename:
    // the config is type-aware (`projectService`), and a path that is not in the
    // TypeScript program fails to parse at all - which would make every case
    // below pass for the wrong reason. keys.ts is a real source file, is not a
    // test file (test files are exempt from this rule block), and only the
    // syntactic rule is asserted.
    const [result] = await eslint.lintText(source, {
      filePath: new URL('./keys.ts', import.meta.url).pathname,
    })
    return (result?.messages ?? [])
      .filter((m) => m.ruleId === 'no-restricted-syntax')
      .map((m) => m.message)
  }

  it('accepts a keyed call', async () => {
    expect(await lint("useMutation({ mutationKey: mutationKeys.createList(), mutationFn: f })")).toEqual([])
  })

  it('rejects an unkeyed call', async () => {
    expect(await lint('useMutation({ mutationFn: f })')).toHaveLength(1)
  })

  it('rejects options hoisted into a variable', async () => {
    expect(await lint('useMutation(opts)')).toHaveLength(1)
  })

  it('rejects a member-expression call', async () => {
    expect(await lint('rq.useMutation({ mutationKey: k, mutationFn: f })')).toHaveLength(1)
  })

  it('rejects an aliased import', async () => {
    const source = "import { useMutation as useMut } from '@tanstack/react-query'"
    expect(await lint(source)).toHaveLength(1)
  })

  it('ignores useMutation inside a comment', async () => {
    // The case that killed the textual scan: src/lib/queries/optimistic.ts has
    // exactly this in its docs, and a grep-based gate counted it as a call site.
    expect(await lint('// useMutation({ mutationFn: f })\nconst x = 1')).toEqual([])
  })
})
