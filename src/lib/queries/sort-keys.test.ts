import { describe, expect, it } from 'vitest'
import {
  gearKey,
  nextCategorySortOrder,
  nextGearItemSortOrder,
  nextListItemSortOrder,
  nextListSortOrder,
} from './sort-keys'

// Direct tests for the sort-slot helpers (review P2.2: consumer tests mock
// these, so the mock was the only assertion). The property that is their
// whole reason to exist: deletes do not compact, so the existing sequence is
// SPARSE, and the next slot must come off the maximum - length-based picking
// collides with a surviving row and the (sortOrder, name) read order then
// reshuffles silently.

const rows = (...sortOrders: number[]) => sortOrders.map((sortOrder) => ({ sortOrder }))

// One shared spec: all four helpers implement the same contract over their
// own row type, and all four must keep doing so independently.
const helpers = [
  ['nextCategorySortOrder', nextCategorySortOrder],
  ['nextGearItemSortOrder', nextGearItemSortOrder],
  ['nextListSortOrder', nextListSortOrder],
  ['nextListItemSortOrder', nextListItemSortOrder],
] as const

describe.each(helpers)('%s', (_name, next) => {
  it('walks off the MAX of a sparse sequence, not the length', () => {
    // Length-based picking would answer 3 here - colliding with the row
    // already holding 3. The gap at 1-2 is what a delete leaves behind.
    expect(next(rows(0, 3, 7))).toBe(8)
  })

  it('is order-independent', () => {
    expect(next(rows(7, 0, 3))).toBe(8)
  })

  it('starts at 0 for an empty collection', () => {
    expect(next([])).toBe(0)
  })

  it('offsets for batched creates without recomputing the max', () => {
    // The CSV import creates N rows in one gesture: each takes max+1+i so
    // none of them recomputes against partially-inserted state.
    expect(next(rows(4), 0)).toBe(5)
    expect(next(rows(4), 1)).toBe(6)
    expect(next(rows(4), 2)).toBe(7)
  })
})

describe('gearKey', () => {
  it('normalizes to NFC before lowercasing, so NFD re-imports match', () => {
    const precomposed = 'café' // é as one codepoint
    const decomposed = 'café' // e + combining acute
    expect(gearKey('c1', precomposed, 100)).toBe(gearKey('c1', decomposed, 100))
    expect(gearKey('c1', 'CAFÉ', 100)).toBe(gearKey('c1', 'café', 100))
  })

  it('distinguishes category, name, and weight', () => {
    expect(gearKey('c1', 'Tent', 900)).not.toBe(gearKey('c2', 'Tent', 900))
    expect(gearKey('c1', 'Tent', 900)).not.toBe(gearKey('c1', 'Tarp', 900))
    expect(gearKey('c1', 'Tent', 900)).not.toBe(gearKey('c1', 'Tent', 901))
    expect(gearKey(null, 'Tent', 900)).not.toBe(gearKey('c1', 'Tent', 900))
  })
})
