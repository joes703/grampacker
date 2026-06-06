import { describe, expect, it } from 'vitest'

// Decision 8: a duplicated list must inherit the table default for is_draft
// (true = draft), NOT the source's status. duplicate_list copies an explicit
// column list and must never thread is_draft - if it did, duplicates would
// carry the source's status instead of resetting to draft. This guard fails if
// any migration that (re)defines duplicate_list references is_draft.
//
// Uses Vite's import.meta.glob (raw) rather than node:fs so it typechecks under
// the app tsconfig (vite/client types, no @types/node) and runs under the same
// Vite transform as the rest of the suite.
const migrations = import.meta.glob('../../../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('duplicate_list draft-default guard', () => {
  it('no duplicate_list definition threads is_draft', () => {
    // Guard against a vacuous pass: the glob must resolve at least one migration
    // (a broken relative path would otherwise yield {} and silently pass).
    expect(Object.keys(migrations).length).toBeGreaterThan(0)
    const offenders = Object.entries(migrations)
      .filter(
        ([, sql]) =>
          /function\s+public\.duplicate_list/.test(sql) && sql.includes('is_draft'),
      )
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
