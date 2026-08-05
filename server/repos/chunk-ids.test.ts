import { describe, expect, it } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { chunkForParamCap, chunkIds, MAX_IDS_PER_STATEMENT } from './chunk-ids'
import { listFoodItemSlots, listItems } from '../db/schema'

// The two splitters that keep every batched statement under D1's
// 100-bound-params cap. Direct tests, because the failure mode is silent:
// an over-cap statement is a runtime D1 error on exactly the large writes
// the suites rarely exercise at size.

describe('chunkIds', () => {
  it('splits at the statement cap and keeps order', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `id-${i}`)
    const chunks = chunkIds(ids)
    expect(chunks.map((c) => c.length)).toEqual([
      MAX_IDS_PER_STATEMENT,
      MAX_IDS_PER_STATEMENT,
      200 - 2 * MAX_IDS_PER_STATEMENT,
    ])
    expect(chunks.flat()).toEqual(ids)
  })

  it('honors a custom size and handles empty input', () => {
    expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunkIds([])).toEqual([])
  })
})

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
