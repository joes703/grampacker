import type {
  DailyTargetMetric,
  FoodPlanDailyTarget,
  MealTarget,
  MealTargetMetric,
  TargetMode,
} from '../../shared/food-plans'
import {
  carbProteinRatio,
  fatPct,
  sugarPct,
  type NutrientKey,
  type NutrientTotal,
} from './nutrition'

// The stored mode set is range/min/max only (I-NO-OFF); "off" exists at the
// VIEW layer as the absence of a stored row - the editor shows it as a mode,
// but it is never on the wire or in the DB.
export type ViewTargetMode = TargetMode | 'off'

// What a graded cell shows. 'off' = no target; 'incomplete' = value unknown,
// not compared; 'neutral' = shown as reference without pass/fail (daily
// target on a Partial day); pass/under/over = graded.
export type TargetStatus =
  | 'off'
  | 'incomplete'
  | 'neutral'
  | 'pass'
  | 'under'
  | 'over'

type TargetBounds = {
  mode: ViewTargetMode
  targetMin: number | null
  targetMax: number | null
}

// Grade a resolved value against a target. `graded` is false for a daily
// target on a Partial day (neutral reference); true for Full days and all
// Meal targets. Exact < / > comparisons - no near-miss tolerance
// (I-GRADING).
export function evaluateTarget(
  target: TargetBounds,
  value: number | null,
  graded: boolean,
): TargetStatus {
  if (target.mode === 'off') return 'off'
  if (value === null) return 'incomplete'
  if (!graded) return 'neutral'
  const { mode, targetMin: lo, targetMax: hi } = target
  if (mode === 'min') return lo !== null && value < lo ? 'under' : 'pass'
  if (mode === 'max') return hi !== null && value > hi ? 'over' : 'pass'
  // range
  if (lo !== null && value < lo) return 'under'
  if (hi !== null && value > hi) return 'over'
  return 'pass'
}

// A NutrientTotal collapses to a number (complete) or null (incomplete =
// unknown, never compared).
export function resolveTotal(total: NutrientTotal): number | null {
  return total.state === 'complete' ? total.value : null
}

const DAILY_NUTRIENT_KEY: Record<
  Exclude<DailyTargetMetric, 'calorie_density'>,
  NutrientKey
> = {
  calories: 'calories',
  protein: 'proteinGrams',
  carbs: 'carbsGrams',
  fiber: 'fiberGrams',
  sodium: 'sodiumMg',
}

// The day's value for a daily metric. calorie_density is passed in (canonical
// kcal/g, computed by calorieDensityPerGram over UNROUNDED grams); the rest
// read the totals.
export function dailyMetricValue(
  metric: DailyTargetMetric,
  totals: Record<NutrientKey, NutrientTotal>,
  calorieDensityPerGram: number | null,
): number | null {
  if (metric === 'calorie_density') return calorieDensityPerGram
  return resolveTotal(totals[DAILY_NUTRIENT_KEY[metric]])
}

// The Meal's value for a meal metric. Ratios/percentages reuse the canonical
// derived functions (same macro-calorie denominator), so they are null unless
// every input nutrient is complete.
export function mealMetricValue(
  metric: MealTargetMetric,
  totals: Record<NutrientKey, NutrientTotal>,
): number | null {
  switch (metric) {
    case 'calories':
      return resolveTotal(totals.calories)
    case 'protein':
      return resolveTotal(totals.proteinGrams)
    case 'fat_pct':
      return fatPct(totals.fatGrams, totals.carbsGrams, totals.proteinGrams)
    case 'sugar_pct':
      return sugarPct(
        totals.sugarGrams,
        totals.fatGrams,
        totals.carbsGrams,
        totals.proteinGrams,
      )
    case 'carb_protein_ratio':
      return carbProteinRatio(totals.carbsGrams, totals.proteinGrams)
  }
}

export type ResolvedTarget<M extends string> = {
  metric: M
  mode: TargetMode
  targetMin: number | null
  targetMax: number | null
  value: number | null
  status: TargetStatus
}

export function dailyMetricForNutrientKey(
  key: NutrientKey,
): DailyTargetMetric | null {
  for (const m of Object.keys(DAILY_NUTRIENT_KEY) as Exclude<
    DailyTargetMetric,
    'calorie_density'
  >[]) {
    if (DAILY_NUTRIENT_KEY[m] === key) return m
  }
  return null
}

// Resolve a day's stored daily targets against its totals. A metric with no
// stored row is simply absent from the map (view-layer "off"). Daily targets
// grade only FULL days; on a Partial day they resolve as neutral reference.
export function resolveDailyTargets(
  targets: FoodPlanDailyTarget[],
  totals: Record<NutrientKey, NutrientTotal>,
  calorieDensityPerGram: number | null,
  dayType: 'full' | 'partial',
): Map<DailyTargetMetric, ResolvedTarget<DailyTargetMetric>> {
  const graded = dayType === 'full'
  const out = new Map<DailyTargetMetric, ResolvedTarget<DailyTargetMetric>>()
  for (const t of targets) {
    const value = dailyMetricValue(t.metric, totals, calorieDensityPerGram)
    out.set(t.metric, {
      metric: t.metric,
      mode: t.mode,
      targetMin: t.targetMin,
      targetMax: t.targetMax,
      value,
      status: evaluateTarget(t, value, graded),
    })
  }
  return out
}

// Meal targets always grade, whatever the day type (I-GRADING).
export function resolveMealTargets(
  targets: MealTarget[],
  totals: Record<NutrientKey, NutrientTotal>,
): Map<MealTargetMetric, ResolvedTarget<MealTargetMetric>> {
  const out = new Map<MealTargetMetric, ResolvedTarget<MealTargetMetric>>()
  for (const t of targets) {
    const value = mealMetricValue(t.metric, totals)
    out.set(t.metric, {
      metric: t.metric,
      mode: t.mode,
      targetMin: t.targetMin,
      targetMax: t.targetMax,
      value,
      status: evaluateTarget(t, value, true),
    })
  }
  return out
}
