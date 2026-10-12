import { describe, expect, it } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { chunkForParamCap } from './chunk-ids'
import { listFoodItemSlots, listItems } from '../db/schema'

// The splitter that keeps list duplication's multi-row INSERTs under the
// per-statement parameter limit. Direct tests, because the failure mode is
// silent: an over-limit statement is a runtime error on exactly the large
// writes the suites rarely exercise at size.

describe('chunkForParamCap', () => {
  it('divides by the TABLE column count, and every chunk stays under 90 params', () => {
    const columns = Object.keys(getTableColumns(listFoodItemSlots)).length
    const rows = Array.from({ length: 100 }, (_, i) => ({
      foodItemId: `f-${i}`,
      slotId: `s-${i}`,
      userId: 'u',
      listId: 'l',
    }))
    const chunks = chunkForParamCap(listFoodItemSlots, rows)
    expect(chunks[0]?.length).toBe(Math.floor(90 / columns))
    for (const chunk of chunks) {
      expect(chunk.length * columns).toBeLessThanOrEqual(90)
    }
    expect(chunks.flat()).toEqual(rows)
  })

  it('ignores the row literal key count - the table width is the bound', () => {
    // The case that motivated the signature change: a literal omitting
    // JS-defaulted columns used to inflate the divisor while drizzle still
    // bound those columns' params. Two keys against list_items' full column
    // set must chunk by the table's width (the conservative upper bound on
    // bindings), not floor(90/2).
    const columns = Object.keys(getTableColumns(listItems)).length
    const skinnyRows = Array.from({ length: 50 }, (_, i) => ({
      id: `li-${i}`,
      listId: 'l',
    }))
    const chunks = chunkForParamCap(listItems, skinnyRows)
    expect(chunks[0]?.length).toBe(Math.floor(90 / columns))
  })

  it('returns no statements for no rows', () => {
    expect(chunkForParamCap(listItems, [])).toEqual([])
  })
})
