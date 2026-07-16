import { describe, expect, it } from 'vitest'
import {
  projectFoodGrams,
  roundProjectedGrams,
  type ProjectionEntry,
} from './food-projection'

// A food with a serving weight and (optionally) a package size. Only the two
// nutrition fields the projection reads are modeled here.
function entry(
  basis: ProjectionEntry['basis'],
  amount: number,
  servingWeightGrams: number,
  servingsPerPackage: number | null = null,
): ProjectionEntry {
  return { basis, amount, servingWeightGrams, servingsPerPackage }
}

describe('projectFoodGrams', () => {
  it('an empty plan projects to zero and is complete', () => {
    expect(projectFoodGrams([])).toEqual({ grams: 0, incomplete: false })
  })

  it('servings basis is amount * serving_weight_grams', () => {
    // 2.5 servings of a 33.3 g serving = 83.25 g (kept full-precision here).
    expect(projectFoodGrams([entry('servings', 2.5, 33.3)])).toEqual({
      grams: 83.25,
      incomplete: false,
    })
  })

  it('weight basis is the amount itself (grams in, grams out)', () => {
    // serving weight is irrelevant on a weight-basis entry; do not multiply it.
    expect(projectFoodGrams([entry('weight', 140, 33.3)])).toEqual({
      grams: 140,
      incomplete: false,
    })
  })

  it('packages basis is amount * servings_per_package * serving_weight_grams', () => {
    // 1.5 packages * 2.5 servings/pkg * 33.3 g/serving = 124.875 g in exact
    // arithmetic. In IEEE-754 the product is 124.87499999999999 - which is the
    // whole reason the total is carried full-precision and rounded exactly once
    // at the boundary rather than pinned to a literal here.
    const { grams, incomplete } = projectFoodGrams([
      entry('packages', 1.5, 33.3, 2.5),
    ])
    expect(grams).toBeCloseTo(124.875, 6)
    expect(incomplete).toBe(false)
    expect(roundProjectedGrams(grams)).toBe(125)
  })

  it('a packages entry with no servings_per_package flags incomplete and adds nothing', () => {
    const result = projectFoodGrams([
      entry('servings', 2, 50), // 100 g, projectable
      entry('packages', 1, 50, null), // unprojectable
    ])
    expect(result).toEqual({ grams: 100, incomplete: true })
  })

  it('a missing package size only affects packages entries, never servings/weight', () => {
    // The same food (serving 50 g, no package size) is fine on servings/weight
    // and only unprojectable on the packages line.
    const complete = projectFoodGrams([
      entry('servings', 1, 50, null),
      entry('weight', 10, 50, null),
    ])
    expect(complete).toEqual({ grams: 60, incomplete: false })
  })

  it('rounds the SUM once, not each entry (per-entry rounding would disagree)', () => {
    // Two 0.5 g entries: rounding each to 0 g gives 0; rounding the 1.0 g sum
    // gives 1. projectFoodGrams must return the full-precision 1.0 so the single
    // boundary rounds it to 1.
    const { grams } = projectFoodGrams([
      entry('weight', 0.5, 1),
      entry('weight', 0.5, 1),
    ])
    expect(grams).toBe(1)
    expect(roundProjectedGrams(grams)).toBe(1)
  })

  it('sums a mixed-basis plan at full precision', () => {
    const { grams, incomplete } = projectFoodGrams([
      entry('servings', 2.5, 33.3), // 83.25
      entry('packages', 1.5, 33.3, 2.5), // 124.875
      entry('weight', 42, 33.3), // 42
    ])
    expect(grams).toBeCloseTo(250.125, 6)
    expect(incomplete).toBe(false)
    expect(roundProjectedGrams(grams)).toBe(250)
  })
})

describe('roundProjectedGrams', () => {
  it('rounds to the nearest integer gram', () => {
    expect(roundProjectedGrams(83.25)).toBe(83)
    expect(roundProjectedGrams(124.875)).toBe(125)
    expect(roundProjectedGrams(0)).toBe(0)
  })
})
