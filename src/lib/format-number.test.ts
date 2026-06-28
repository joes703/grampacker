import { describe, it, expect } from 'vitest'
import { trimNumber } from './format-number'

describe('trimNumber', () => {
  it('trims trailing zeros at the requested precision', () => {
    expect(trimNumber(30, 1)).toBe('30')
    expect(trimNumber(30.5, 1)).toBe('30.5')
    expect(trimNumber(30.0, 1)).toBe('30')
  })

  it('rounds to the requested number of decimals', () => {
    expect(trimNumber(2.3456, 3)).toBe('2.346')
    expect(trimNumber(2.3456, 2)).toBe('2.35')
    expect(trimNumber(2.3456, 1)).toBe('2.3')
  })

  it('keeps integers as integers across precisions', () => {
    expect(trimNumber(5, 3)).toBe('5')
    expect(trimNumber(5, 2)).toBe('5')
    expect(trimNumber(5, 0)).toBe('5')
  })

  // Each call site that previously hand-rolled trailing-zero trimming maps onto
  // a single digits argument; these lock the equivalence so a precision change
  // is a deliberate, visible edit.
  it('reproduces the prior per-call-site formatters', () => {
    expect(trimNumber(1.25, 3)).toBe('1.25') // formatAmount (toFixed 3)
    expect(trimNumber(1.5, 2)).toBe('1.5') //  formatDerivedNumber (toFixed 2)
    expect(trimNumber(9.98, 1)).toBe('10') //  trimNum / formatServings (toFixed 1)
  })
})
