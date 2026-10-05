// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from 'vitest'
import {
  SHARE_WEIGHT_UNIT_KEY,
  WEIGHT_UNIT_KEY,
  formatGrams,
  formatItemWeight,
  formatTotalWeight,
  getShareWeightUnit,
  getWeightUnit,
  roundGrams,
  setShareWeightUnit,
  setWeightUnit,
} from './weight'

describe('roundGrams', () => {
  it('snaps to one decimal place', () => {
    expect(roundGrams(12.4)).toBe(12.4)
    expect(roundGrams(12.44)).toBe(12.4)
    expect(roundGrams(12.46)).toBe(12.5)
    expect(roundGrams(240)).toBe(240)
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
    // would put "0.30000000000000004 g" on the page. This also proves that
    // roundGrams snaps a sum: a scale-then-multiply rounding (x10, then x0.1)
    // passes every roundGrams case above but not this one.
    expect(formatGrams(0.1 + 0.2)).toBe('0.3')
    expect(String(0.1 + 0.2)).not.toBe('0.3')
  })
})

// formatItemWeight is the per-row formatter — oz-only in imperial mode so
// row columns stay narrow and tabular. Pinning the behavior so a future
// "tidy-up" can't accidentally widen it into lb+oz at row scale.
describe('formatItemWeight', () => {
  it('shows a fractional gram without padding a whole one', () => {
    expect(formatItemWeight(0, 'g')).toBe('0 g')
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
    expect(formatTotalWeight(14000, 'g')).toBe('14000 g')
    expect(formatTotalWeight(0, 'g')).toBe('0 g')
  })
})

// The public share view (/r/:slug) is anonymous and may be opened by anyone,
// on any browser. If it wrote WEIGHT_UNIT_KEY, the key the authenticated app
// reads, a stranger toggling oz on a shared list would reconfigure that
// device's own gear, lists and food views. These tests pin the isolation, in
// the direction that matters: share writes must NEVER touch the app's key.
describe('share weight unit isolation', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('never writes the authenticated key when the share unit changes', () => {
    setWeightUnit('g')
    setShareWeightUnit('oz')
    expect(localStorage.getItem(WEIGHT_UNIT_KEY)).toBe('g')
    expect(getWeightUnit()).toBe('g')
    expect(getShareWeightUnit()).toBe('oz')
  })

  it('reads through to the app preference until the viewer chooses', () => {
    // An owner opening their own share link starts in their usual units.
    setWeightUnit('oz')
    expect(getShareWeightUnit()).toBe('oz')
    // ...but once the viewer picks, the two are independent.
    setShareWeightUnit('g')
    expect(getShareWeightUnit()).toBe('g')
    expect(getWeightUnit()).toBe('oz')
    // A later app change must not clobber the viewer's explicit choice.
    setWeightUnit('oz')
    expect(getShareWeightUnit()).toBe('g')
  })

  it('treats a corrupt share value as no preference, not as g', () => {
    // localStorage is a trust boundary; anything can be in there.
    //
    // Both keys are set on purpose. With the app key unset, read-through lands
    // on getWeightUnit's own 'g' default, so the test could not tell "falls
    // back to g" from "reads through".
    localStorage.setItem(SHARE_WEIGHT_UNIT_KEY, 'stones')
    setWeightUnit('oz')
    expect(getShareWeightUnit()).toBe('oz')
  })

  it('bottoms out at g when BOTH keys are corrupt', () => {
    // The end of the fallback chain: no usable value anywhere.
    localStorage.setItem(SHARE_WEIGHT_UNIT_KEY, 'stones')
    localStorage.setItem(WEIGHT_UNIT_KEY, 'furlongs')
    expect(getShareWeightUnit()).toBe('g')
  })
})
