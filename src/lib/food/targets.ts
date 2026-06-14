// src/lib/food/targets.ts
import type { DailyTargetMetric, FoodPlanDailyTarget, MealTarget, MealTargetMetric, TargetMode } from '../types'
import {
  carbProteinRatio, fatPct, sugarPct,
  type NutrientKey, type NutrientTotal,
} from './nutrition'

// What a graded cell shows. 'off' = no target; 'incomplete' = value unknown, not
// compared (Story 6); 'neutral' = shown as reference without pass/fail (Partial
// day, daily target); pass/under/over = graded.
export type TargetStatus = 'off' | 'incomplete' | 'neutral' | 'pass' | 'under' | 'over'

type TargetBounds = { mode: TargetMode; target_min: number | null; target_max: number | null }

// Grade a resolved value against a target. `graded` is false for a daily target
// on a Partial day (neutral reference); true for Full days and all Meal targets.
export function evaluateTarget(target: TargetBounds, value: number | null, graded: boolean): TargetStatus {
  if (target.mode === 'off') return 'off'
  if (value === null) return 'incomplete'
  if (!graded) return 'neutral'
  const { mode, target_min: lo, target_max: hi } = target
  if (mode === 'min') return lo != null && value < lo ? 'under' : 'pass'
  if (mode === 'max') return hi != null && value > hi ? 'over' : 'pass'
  // range
  if (lo != null && value < lo) return 'under'
  if (hi != null && value > hi) return 'over'
  return 'pass'
}

// A NutrientTotal collapses to a number (complete) or null (incomplete = unknown,
// never compared).
export function resolveTotal(total: NutrientTotal): number | null {
  return total.state === 'complete' ? total.value : null
}

const DAILY_NUTRIENT_KEY: Record<Exclude<DailyTargetMetric, 'calorie_density'>, NutrientKey> = {
  calories: 'calories', protein: 'protein_grams', carbs: 'carbs_grams',
  fiber: 'fiber_grams', sodium: 'sodium_mg',
}

// The day's value for a daily metric. calorie_density is passed in (canonical
// kcal/g, computed by 3A's calorieDensityPerGram); the rest read the totals.
export function dailyMetricValue(
  metric: DailyTargetMetric,
  totals: Record<NutrientKey, NutrientTotal>,
  calorieDensityPerGram: number | null,
): number | null {
  if (metric === 'calorie_density') return calorieDensityPerGram
  return resolveTotal(totals[DAILY_NUTRIENT_KEY[metric]])
}

// The Meal's value for a meal metric. Ratios/percentages reuse 3A's canonical
// derived functions (same macro-calorie denominator), so they are null unless
// every input nutrient is complete.
export function mealMetricValue(
  metric: MealTargetMetric,
  totals: Record<NutrientKey, NutrientTotal>,
): number | null {
  switch (metric) {
    case 'calories': return resolveTotal(totals.calories)
    case 'protein': return resolveTotal(totals.protein_grams)
    case 'fat_pct': return fatPct(totals.fat_grams, totals.carbs_grams, totals.protein_grams)
    case 'sugar_pct': return sugarPct(totals.sugar_grams, totals.fat_grams, totals.carbs_grams, totals.protein_grams)
    case 'carb_protein_ratio': return carbProteinRatio(totals.carbs_grams, totals.protein_grams)
  }
}

export type ResolvedTarget<M extends string> = {
  metric: M; mode: TargetMode; target_min: number | null; target_max: number | null
  value: number | null; status: TargetStatus
}

export function dailyMetricForNutrientKey(key: NutrientKey): DailyTargetMetric | null {
  for (const m of Object.keys(DAILY_NUTRIENT_KEY) as Exclude<DailyTargetMetric, 'calorie_density'>[]) {
    if (DAILY_NUTRIENT_KEY[m] === key) return m
  }
  return null
}

export function resolveDailyTargets(
  targets: FoodPlanDailyTarget[], totals: Record<NutrientKey, NutrientTotal>,
  calorieDensityPerGram: number | null, dayType: 'full' | 'partial',
): Map<DailyTargetMetric, ResolvedTarget<DailyTargetMetric>> {
  const graded = dayType === 'full'
  const out = new Map<DailyTargetMetric, ResolvedTarget<DailyTargetMetric>>()
  for (const t of targets) {
    const value = dailyMetricValue(t.metric, totals, calorieDensityPerGram)
    out.set(t.metric, { metric: t.metric, mode: t.mode, target_min: t.target_min, target_max: t.target_max, value, status: evaluateTarget(t, value, graded) })
  }
  return out
}

export function resolveMealTargets(
  targets: MealTarget[], totals: Record<NutrientKey, NutrientTotal>,
): Map<MealTargetMetric, ResolvedTarget<MealTargetMetric>> {
  const out = new Map<MealTargetMetric, ResolvedTarget<MealTargetMetric>>()
  for (const t of targets) {
    const value = mealMetricValue(t.metric, totals)
    out.set(t.metric, { metric: t.metric, mode: t.mode, target_min: t.target_min, target_max: t.target_max, value, status: evaluateTarget(t, value, true) })
  }
  return out
}
