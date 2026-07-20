import { describe, it, expect } from 'vitest'
import { formatGrams, formatItemWeight, formatTotalWeight, roundGrams } from './weight'

describe('roundGrams', () => {
  it('snaps to one decimal place', () => {
    expect(roundGrams(12.4)).toBe(12.4)
    expect(roundGrams(12.44)).toBe(12.4)
    expect(roundGrams(12.46)).toBe(12.5)
    expect(roundGrams(240)).toBe(240)
  })

  it('collapses the float noise a sum introduces', () => {
    expect(roundGrams(0.1 + 0.2)).toBe(0.3)
  })
})

describe('formatGrams', () => {
  it('trims trailing zeros so whole grams stay whole', () => {
    expect(formatGrams(240)).toBe('240')
    expect(formatGrams(12.4)).toBe('12.4')
    expect(formatGrams(0)).toBe('0')
  })

  it('never renders float noise', () => {
    // The reason this formatter exists: raw interpolation of a summed weight
    // would put "0.30000000000000004 g" on the page.
    expect(formatGrams(0.1 + 0.2)).toBe('0.3')
    expect(String(0.1 + 0.2)).not.toBe('0.3')
  })
})

// formatItemWeight is the per-row formatter — oz-only in imperial mode so
// row columns stay narrow and tabular. Pinning the behavior so a future
// "tidy-up" can't accidentally widen it into lb+oz at row scale.
describe('formatItemWeight', () => {
  it('renders grams unchanged in g mode', () => {
    expect(formatItemWeight(0, 'g')).toBe('0 g')
    expect(formatItemWeight(450, 'g')).toBe('450 g')
  })

  it('shows a fractional gram without padding a whole one', () => {
    expect(formatItemWeight(12.4, 'g')).toBe('12.4 g')
    expect(formatItemWeight(240, 'g')).toBe('240 g')
  })

  it('renders oz-only in oz mode regardless of magnitude', () => {
    // A 14-pound pack at row scale would never happen, but the formatter
    // must not silently switch into lb+oz — that would be a layout
    // regression in the item rows.
    expect(formatItemWeight(28, 'oz')).toBe('1.0 oz')
    expect(formatItemWeight(454, 'oz')).toBe('16.0 oz')
    expect(formatItemWeight(6350, 'oz')).toBe('224.0 oz')
  })
})

// formatTotalWeight is the aggregate formatter — used for group/category
// totals on list views, share view, and the mobile WeightSummary strip.
// Once a value crosses 1 lb in oz mode it rolls into compound lb+oz so big
// numbers stay readable. The 16-oz boundary is the load-bearing case.
describe('formatTotalWeight', () => {
  it('renders grams unchanged in g mode', () => {
    expect(formatTotalWeight(0, 'g')).toBe('0 g')
    expect(formatTotalWeight(14000, 'g')).toBe('14000 g')
  })

  it('renders oz-only under 1 lb in oz mode', () => {
    expect(formatTotalWeight(0, 'oz')).toBe('0.0 oz')
    expect(formatTotalWeight(100, 'oz')).toBe('3.5 oz')
    // Just below the 1 lb boundary (16 oz ≈ 453.59 g): stays in oz.
    expect(formatTotalWeight(450, 'oz')).toBe('15.9 oz')
  })

  it('rolls into lb+oz at and above 1 lb in oz mode', () => {
    // 454 g ≈ 16.01 oz → 1 lb 0.0 oz.
    expect(formatTotalWeight(454, 'oz')).toBe('1 lb 0.0 oz')
    expect(formatTotalWeight(500, 'oz')).toBe('1 lb 1.6 oz')
    // Pack-weight territory: 14 kg → ~30 lb 13.8 oz.
    expect(formatTotalWeight(14000, 'oz')).toBe('30 lb 13.8 oz')
  })

  it('keeps a summed fractional total clean in g mode', () => {
    // Three 0.1 g items sum to 0.30000000000000004 in IEEE-754. This is the
    // aggregate path, where individual one-decimal snapping does not apply.
    expect(formatTotalWeight(0.1 + 0.1 + 0.1, 'g')).toBe('0.3 g')
    expect(formatTotalWeight(1234.5, 'g')).toBe('1234.5 g')
  })
})
