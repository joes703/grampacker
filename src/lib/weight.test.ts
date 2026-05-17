import { describe, it, expect } from 'vitest'
import { formatItemWeight, formatTotalWeight } from './weight'

// formatItemWeight is the per-row formatter — oz-only in imperial mode so
// row columns stay narrow and tabular. Pinning the behavior so a future
// "tidy-up" can't accidentally widen it into lb+oz at row scale.
describe('formatItemWeight', () => {
  it('renders grams unchanged in g mode', () => {
    expect(formatItemWeight(0, 'g')).toBe('0 g')
    expect(formatItemWeight(450, 'g')).toBe('450 g')
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
})
