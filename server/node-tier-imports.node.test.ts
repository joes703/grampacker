import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

// A .node.test.ts runs in the unit tier, which has no per-file database
// setup. Importing server/index.ts, or the API-tier helpers that open SQLite
// and build the app at module scope (server/test/node-env.ts, and
// api-helpers / auth-helpers through it), turns it into an API test that
// skips the API suite's isolation. eslint.config.js forbids those imports; a
// green lint run proves nothing unless the rule bites, so this asserts it
// does, from two directory depths.

let eslint: ESLint

// The first lint starts the type-aware TypeScript program, which takes
// seconds. Pay it once, with room to spare.
beforeAll(async () => {
  eslint = new ESLint()
  await lint('const warm = 1', 'node-tier-imports.node.test.ts')
}, 60_000)

// The config is type-aware, so the fixture must be attributed to a file that
// is in the TypeScript program: this file (depth 0) or a real depth-1 one.
async function lint(source: string, serverRelativePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, {
    filePath: new URL(`./${serverRelativePath}`, import.meta.url).pathname,
  })
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === '@typescript-eslint/no-restricted-imports')
    .map((m) => m.message)
}

const DEPTH_0 = 'node-tier-imports.node.test.ts'
const DEPTH_1 = 'middleware/error-handler.node.test.ts'

describe('imports a .node.test.ts may not make', () => {
  it.each([
    [DEPTH_0, './test/node-env'],
    [DEPTH_0, './test/api-helpers'],
    [DEPTH_0, './test/auth-helpers.ts'],
    [DEPTH_1, '../test/node-env'],
    [DEPTH_1, '../test/api-helpers.js'],
    [DEPTH_1, '../test/auth-helpers'],
  ])('%s: rejects %s', async (file, specifier) => {
    expect(await lint(`import '${specifier}'`, file)).toHaveLength(1)
  })

  it.each([
    [DEPTH_0, './index'],
    [DEPTH_1, '../index'],
    [DEPTH_1, '..'],
  ])('%s: still rejects the app entry, %s', async (file, specifier) => {
    expect(await lint(`import '${specifier}'`, file)).toHaveLength(1)
  })

  it('allows the pure modules a unit test is for', async () => {
    expect(await lint("import './error-handler'", DEPTH_1)).toEqual([])
    expect(await lint("import '../test/fixtures/assets'", DEPTH_1)).toEqual([])
  })
})
