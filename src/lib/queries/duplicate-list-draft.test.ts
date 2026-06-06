import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Decision 8: a duplicated list must inherit the table default for is_draft
// (true = draft), NOT the source's status. duplicate_list copies an explicit
// column list and must never thread is_draft - if it did, duplicates would
// carry the source's status instead of resetting to draft. This guard fails if
// any migration that (re)defines duplicate_list references is_draft.
describe('duplicate_list draft-default guard', () => {
  it('no duplicate_list definition threads is_draft', () => {
    const dir = join(process.cwd(), 'supabase/migrations')
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => {
        const sql = readFileSync(join(dir, f), 'utf8')
        return /function\s+public\.duplicate_list/.test(sql) && sql.includes('is_draft')
      })
    expect(offenders).toEqual([])
  })
})
