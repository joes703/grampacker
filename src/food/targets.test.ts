import { describe, it, expect } from 'vitest'
import {
  dailyMetricForNutrientKey,
  dailyMetricValue,
  evaluateTarget,
  mealMetricValue,
  resolveDailyTargets,
  resolveMealTargets,
  resolveTotal,
} from './targets'
import type { NutrientKey, NutrientTotal } from './nutrition'
import type { FoodPlanDailyTarget, MealTarget } from '../../shared/food-plans'

const C = (value: number): NutrientTotal => ({ state: 'complete', value })
const INC = (...ids: string[]): NutrientTotal => ({
  state: 'incomplete',
  missingFoodIds: ids,
})

function totals(
  overrides: Partial<Record<NutrientKey, NutrientTotal>> = {},
): Record<NutrientKey, NutrientTotal> {
  const base = {} as Record<NutrientKey, NutrientTotal>
  const keys: NutrientKey[] = [
    'calories',
    'fatGrams',
    'saturatedFatGrams',
    'carbsGrams',
    'fiberGrams',
    'sugarGrams',
    'proteinGrams',
    'sodiumMg',
    'potassiumMg',
  ]
  for (const k of keys) base[k] = C(0)
  return { ...base, ...overrides }
}

describe('evaluateTarget', () => {
  it('off mode (a metric with no stored row) is not shown', () => {
    expect(
      evaluateTarget({ mode: 'off', targetMin: null, targetMax: null }, 100, true),
    ).toBe('off')
  })
  it('an unknown value (incomplete total) is never compared', () => {
    expect(
      evaluateTarget({ mode: 'range', targetMin: 1, targetMax: 2 }, null, true),
    ).toBe('incomplete')
  })
  it('a non-graded daily target is neutral reference', () => {
    expect(
      evaluateTarget(
        { mode: 'range', targetMin: 2000, targetMax: 3000 },
        2500,
        false,
      ),
    ).toBe('neutral')
  })
  it('range grades under / pass / over with exact comparisons (no tolerance)', () => {
    const t = { mode: 'range' as const, targetMin: 2000, targetMax: 3000 }
    expect(evaluateTarget(t, 1500, true)).toBe('under')
    expect(evaluateTarget(t, 2000, true)).toBe('pass') // boundary is inclusive
    expect(evaluateTarget(t, 2500, true)).toBe('pass')
    expect(evaluateTarget(t, 3000, true)).toBe('pass')
    expect(evaluateTarget(t, 3500, true)).toBe('over')
  })
  it('min grades a one-sided floor', () => {
    const t = { mode: 'min' as const, targetMin: 4.5, targetMax: null }
    expect(evaluateTarget(t, 4.0, true)).toBe('under')
    expect(evaluateTarget(t, 4.5, true)).toBe('pass')
    expect(evaluateTarget(t, 5.0, true)).toBe('pass')
  })
  it('max grades a one-sided ceiling', () => {
    const t = { mode: 'max' as const, targetMin: null, targetMax: 1500 }
    expect(evaluateTarget(t, 1800, true)).toBe('over')
    expect(evaluateTarget(t, 1500, true)).toBe('pass')
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
    const t = totals({ proteinGrams: C(120), sodiumMg: C(2300) })
    expect(dailyMetricValue('protein', t, null)).toBe(120)
    expect(dailyMetricValue('sodium', t, null)).toBe(2300)
  })
  it('calorie_density uses the passed canonical kcal/g', () => {
    expect(dailyMetricValue('calorie_density', totals(), 4.2)).toBe(4.2)
    expect(dailyMetricValue('calorie_density', totals(), null)).toBeNull()
  })
  it('an incomplete absolute metric resolves to null (never compared)', () => {
    expect(dailyMetricValue('fiber', totals({ fiberGrams: INC('x') }), null)).toBeNull()
  })
})

describe('mealMetricValue', () => {
  it('fat_pct uses the macro-calorie denominator (needs fat, carbs, protein)', () => {
    const t = totals({ fatGrams: C(10), carbsGrams: C(20), proteinGrams: C(10) })
    // 90 / (90+80+40) * 100 = 42.857
    expect(mealMetricValue('fat_pct', t)).toBeCloseTo(42.857, 2)
    expect(
      mealMetricValue(
        'fat_pct',
        totals({ fatGrams: C(10), carbsGrams: INC('x'), proteinGrams: C(10) }),
      ),
    ).toBeNull()
  })
  it('sugar_pct shares the denominator', () => {
    const t = totals({
      sugarGrams: C(25),
      fatGrams: C(10),
      carbsGrams: C(40),
      proteinGrams: C(10),
    })
    expect(mealMetricValue('sugar_pct', t)).toBeCloseTo(34.483, 2)
  })
  it('carb_protein_ratio needs both and protein > 0', () => {
    expect(
      mealMetricValue(
        'carb_protein_ratio',
        totals({ carbsGrams: C(60), proteinGrams: C(20) }),
      ),
    ).toBeCloseTo(3, 5)
    expect(
      mealMetricValue(
        'carb_protein_ratio',
        totals({ carbsGrams: C(60), proteinGrams: C(0) }),
      ),
    ).toBeNull()
  })
})

const daily = (
  o: Partial<FoodPlanDailyTarget> &
    Pick<FoodPlanDailyTarget, 'metric' | 'mode'>,
): FoodPlanDailyTarget => ({ id: 'd', targetMin: null, targetMax: null, ...o })
const meal = (
  o: Partial<MealTarget> & Pick<MealTarget, 'metric' | 'mode'>,
): MealTarget => ({ id: 'm', mealId: 'mm', targetMin: null, targetMax: null, ...o })

describe('dailyMetricForNutrientKey', () => {
  it('maps columns to metrics, null where none', () => {
    expect(dailyMetricForNutrientKey('proteinGrams')).toBe('protein')
    expect(dailyMetricForNutrientKey('fatGrams')).toBeNull()
  })
})

describe('resolveDailyTargets', () => {
  it('grades Full, neutral on Partial', () => {
    const t = [daily({ metric: 'calories', mode: 'range', targetMin: 2000, targetMax: 3000 })]
    expect(
      resolveDailyTargets(t, totals({ calories: C(3500) }), null, 'full').get('calories')?.status,
    ).toBe('over')
    expect(
      resolveDailyTargets(t, totals({ calories: C(3500) }), null, 'partial').get('calories')?.status,
    ).toBe('neutral')
  })
  it('a metric with no row is simply absent (view-layer off)', () => {
    expect(resolveDailyTargets([], totals(), null, 'full').size).toBe(0)
  })
})

describe('resolveMealTargets', () => {
  it('always grades; incomplete input -> incomplete', () => {
    const t = [meal({ metric: 'fat_pct', mode: 'max', targetMax: 30 })]
    expect(
      resolveMealTargets(
        t,
        totals({ fatGrams: C(10), carbsGrams: C(20), proteinGrams: C(10) }),
      ).get('fat_pct')?.status,
    ).toBe('over')
    expect(
      resolveMealTargets(
        t,
        totals({ fatGrams: C(10), carbsGrams: INC('x'), proteinGrams: C(10) }),
      ).get('fat_pct')?.status,
    ).toBe('incomplete')
  })
})
