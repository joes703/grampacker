import { describe, expect, it } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import {
  chunkForParamCap,
  PARAM_BUDGET_PER_STATEMENT,
  rowsPerStatement,
  SQLITE_MAX_PARAMS,
} from './chunk-ids'
import { listFoodItemSlots, listItems } from '../db/schema'

// The splitter that keeps list duplication's multi-row INSERTs under SQLite's
// per-statement parameter limit. Direct tests, because the failure mode is
// silent: an over-limit statement is a runtime error on exactly the large
// writes the suites rarely exercise at size. The full-size copy against real
// SQLite is server/repos/list-duplicate-size.test.ts.

describe('chunkForParamCap', () => {
  it('keeps a quarter of SQLite\'s limit as margin', () => {
    // server/db/sqlite.test.ts proves the real limit is SQLITE_MAX_PARAMS.
    expect(SQLITE_MAX_PARAMS).toBe(32766)
    expect(PARAM_BUDGET_PER_STATEMENT).toBe(8191)
    expect(PARAM_BUDGET_PER_STATEMENT * 4).toBeLessThanOrEqual(SQLITE_MAX_PARAMS)
  })

  it('divides by the TABLE column count, and every chunk stays within the budget', () => {
    const columns = Object.keys(getTableColumns(listFoodItemSlots)).length
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      foodItemId: `f-${i}`,
      slotId: `s-${i}`,
      userId: 'u',
      listId: 'l',
    }))
    const chunks = chunkForParamCap(listFoodItemSlots, rows)
    expect(chunks[0]?.length).toBe(Math.floor(PARAM_BUDGET_PER_STATEMENT / columns))
    expect(chunks).toHaveLength(Math.ceil(5000 / rowsPerStatement(listFoodItemSlots)))
    for (const chunk of chunks) {
      expect(chunk.length * columns).toBeLessThanOrEqual(PARAM_BUDGET_PER_STATEMENT)
    }
    expect(chunks.flat()).toEqual(rows)
  })

  it('ignores the row literal key count - the table width is the bound', () => {
    // A literal omitting JS-defaulted columns must not inflate the rows per
    // statement while drizzle still binds those columns. Two keys against
    // list_items' full column set must chunk by the table's width.
    const columns = Object.keys(getTableColumns(listItems)).length
    const skinnyRows = Array.from({ length: 2000 }, (_, i) => ({
      id: `li-${i}`,
      listId: 'l',
    }))
    const chunks = chunkForParamCap(listItems, skinnyRows)
    expect(chunks[0]?.length).toBe(Math.floor(PARAM_BUDGET_PER_STATEMENT / columns))
  })

  it('returns no statements for no rows', () => {
    expect(chunkForParamCap(listItems, [])).toEqual([])
  })
})
