import { describe, expect, it } from 'vitest'
import { comparePackOrder, type PackOrderKey } from './lists'

// The one display order for a pack cohort, used by the server (unionOrder in
// server/repos/pack-reorder.ts) and the client (comparePackRows in
// src/lists/pack-rows.ts), so a cohort the server appends and the list the
// client renders agree.
const sorted = (rows: PackOrderKey[]) => [...rows].sort(comparePackOrder).map((r) => `${r.kind}:${r.id}`)

describe('comparePackOrder', () => {
  it('orders by rank first', () => {
    expect(
      sorted([
        { kind: 'food', rank: 2, id: 'a' },
        { kind: 'gear', rank: 1, id: 'z' },
      ]),
    ).toEqual(['gear:z', 'food:a'])
  })

  // Per-table unique indexes cannot rule out a tie across the two tables.
  it('puts gear before food on a cross-table rank tie', () => {
    expect(
      sorted([
        { kind: 'food', rank: 1, id: 'a' },
        { kind: 'gear', rank: 1, id: 'z' },
      ]),
    ).toEqual(['gear:z', 'food:a'])
  })

  it('falls back to id for a total order', () => {
    expect(
      sorted([
        { kind: 'gear', rank: 1, id: 'b' },
        { kind: 'gear', rank: 1, id: 'a' },
      ]),
    ).toEqual(['gear:a', 'gear:b'])
  })
})
