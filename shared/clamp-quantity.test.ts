import { describe, expect, it } from 'vitest'
import { MAX_LIST_ITEM_QUANTITY, clampQuantity } from './lists'

// Every quantity field reads its value through this one rule: round to the
// nearest whole number, then keep it between 1 and the maximum. Anything that
// is not a number becomes 1.
describe('clampQuantity', () => {
  it.each([
    ['3', 3],
    ['2.6', 3],
    ['2.4', 2],
    [2.6, 3],
    ['', 1],
    ['abc', 1],
    ['0', 1],
    ['-5', 1],
    [String(MAX_LIST_ITEM_QUANTITY + 1), MAX_LIST_ITEM_QUANTITY],
  ])('%j -> %s', (raw, expected) => {
    expect(clampQuantity(raw)).toBe(expected)
  })

  it('takes another maximum', () => {
    expect(clampQuantity('50', 10)).toBe(10)
  })
})
