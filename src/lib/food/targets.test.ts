// src/lib/food/targets.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateTarget, resolveTotal, dailyMetricValue, mealMetricValue } from './targets'
import type { NutrientKey, NutrientTotal } from './nutrition'

const C = (value: number): NutrientTotal => ({ state: 'complete', value })
const INC = (...ids: string[]): NutrientTotal => ({ state: 'incomplete', missingFoodIds: ids })

function totals(overrides: Partial<Record<NutrientKey, NutrientTotal>> = {}): Record<NutrientKey, NutrientTotal> {
  const base = {} as Record<NutrientKey, NutrientTotal>
  const keys: NutrientKey[] = ['calories','fat_grams','saturated_fat_grams','carbs_grams','fiber_grams','sugar_grams','protein_grams','sodium_mg','potassium_mg']
  for (const k of keys) base[k] = C(0)
  return { ...base, ...overrides }
}

describe('evaluateTarget', () => {
  it('off mode is not shown', () => {
    expect(evaluateTarget({ mode: 'off', target_min: null, target_max: null }, 100, true)).toBe('off')
  })
  it('an unknown value (incomplete total) is never compared', () => {
    expect(evaluateTarget({ mode: 'range', target_min: 1, target_max: 2 }, null, true)).toBe('incomplete')
  })
  it('a non-graded daily target is neutral reference', () => {
    expect(evaluateTarget({ mode: 'range', target_min: 2000, target_max: 3000 }, 2500, false)).toBe('neutral')
  })
  it('range grades under / pass / over', () => {
    const t = { mode: 'range' as const, target_min: 2000, target_max: 3000 }
    expect(evaluateTarget(t, 1500, true)).toBe('under')
    expect(evaluateTarget(t, 2500, true)).toBe('pass')
    expect(evaluateTarget(t, 3500, true)).toBe('over')
  })
  it('min grades a one-sided floor', () => {
    const t = { mode: 'min' as const, target_min: 4.5, target_max: null }
    expect(evaluateTarget(t, 4.0, true)).toBe('under')
    expect(evaluateTarget(t, 5.0, true)).toBe('pass')
  })
  it('max grades a one-sided ceiling', () => {
    const t = { mode: 'max' as const, target_min: null, target_max: 1500 }
    expect(evaluateTarget(t, 1800, true)).toBe('over')
    expect(evaluateTarget(t, 1200, true)).toBe('pass')
  })
})

describe('resolveTotal', () => {
  it('complete -> value, incomplete -> null', () => {
    expect(resolveTotal(C(42))).toBe(42)
    expect(resolveTotal(INC('x'))).toBeNull()
  })
})

describe('dailyMetricValue', () => {
  it('maps absolute metrics to their nutrient total', () => {
    const t = totals({ protein_grams: C(120), sodium_mg: C(2300) })
    expect(dailyMetricValue('protein', t, null)).toBe(120)
    expect(dailyMetricValue('sodium', t, null)).toBe(2300)
  })
  it('calorie_density uses the passed canonical kcal/g', () => {
    expect(dailyMetricValue('calorie_density', totals(), 4.2)).toBe(4.2)
    expect(dailyMetricValue('calorie_density', totals(), null)).toBeNull()
  })
  it('an incomplete absolute metric resolves to null (never compared)', () => {
    expect(dailyMetricValue('fiber', totals({ fiber_grams: INC('x') }), null)).toBeNull()
  })
})

describe('mealMetricValue', () => {
  it('fat_pct uses the macro-calorie denominator (needs fat, carbs, protein)', () => {
    const t = totals({ fat_grams: C(10), carbs_grams: C(20), protein_grams: C(10) })
    // 90 / (90+80+40) * 100 = 42.857
    expect(mealMetricValue('fat_pct', t)).toBeCloseTo(42.857, 2)
    expect(mealMetricValue('fat_pct', totals({ fat_grams: C(10), carbs_grams: INC('x'), protein_grams: C(10) }))).toBeNull()
  })
  it('carb_protein_ratio needs both and protein > 0', () => {
    expect(mealMetricValue('carb_protein_ratio', totals({ carbs_grams: C(60), protein_grams: C(20) }))).toBeCloseTo(3, 5)
  })
})
