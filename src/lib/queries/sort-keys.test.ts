import { describe, expect, it } from 'vitest'
import { nextSortOrder } from './sort-keys'

describe('nextSortOrder', () => {
  it('returns 0 for an empty list', () => {
    expect(nextSortOrder([])).toBe(0)
  })

  it('returns max+1 over a sparse sequence (gaps from earlier deletes)', () => {
    // A delete leaves [0, 2, 3]; length-based slot picking would return 3,
    // colliding with the existing row at sortOrder 3.
    expect(nextSortOrder([{ sortOrder: 0 }, { sortOrder: 2 }, { sortOrder: 3 }])).toBe(4)
  })

  it('does not depend on input order', () => {
    expect(nextSortOrder([{ sortOrder: 3 }, { sortOrder: 0 }, { sortOrder: 2 }])).toBe(4)
  })
})
