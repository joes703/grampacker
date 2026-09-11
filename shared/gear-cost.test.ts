import { describe, expect, it } from 'vitest'
import { costSchema } from './gear'

// costSchema used to check decimals with an epsilon (`abs(v*100 -
// round(v*100)) < 1e-6`), which is magnitude-fragile: it admitted 1e-9 (stored
// as 0 cents) and 99999999.00999999 (v*100 lands exactly on an integer near
// the cap). The round-trip form rejects both and keeps the inclusive cap.
describe('costSchema', () => {
  it.each([0, 12.34, 99_999_999.99, 0.01, 5])('accepts %s', (v) => {
    expect(costSchema.safeParse(v).success).toBe(true)
  })

  it.each([1e-9, 99_999_999.00999999, 12.345, -0.01, 100_000_000])('rejects %s', (v) => {
    expect(costSchema.safeParse(v).success).toBe(false)
  })
})
