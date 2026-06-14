import { ozToGrams, type WeightUnit } from '../lib/weight'
import type { DailyTargetMetric, MealTargetMetric, TargetMode } from '../lib/types'

// grams in one ounce (~28.3495); ozToGrams(1) keeps this single-sourced.
const GRAMS_PER_OUNCE = ozToGrams(1)

// Convert canonical kcal/g to a display string in the user's weight unit.
// kcal/oz = kcal/g * grams_per_ounce.
export function formatCalorieDensity(kcalPerGram: number | null, unit: WeightUnit): string {
  if (kcalPerGram === null) return '-'
  if (unit === 'oz') return `${(kcalPerGram * GRAMS_PER_OUNCE).toFixed(1)} kcal/oz`
  return `${kcalPerGram.toFixed(2)} kcal/g`
}

export function formatPct(value: number | null): string { return value === null ? '-' : `${value.toFixed(1)}%` }
export function formatRatio(value: number | null): string { return value === null ? '-' : value.toFixed(2) }
export function formatSodiumDensity(mgPerKcal: number | null): string { return mgPerKcal === null ? '-' : `${mgPerKcal.toFixed(1)} mg/kcal` }
export function kcalPerGramToInput(kcalPerGram: number, unit: WeightUnit): number { return unit === 'oz' ? kcalPerGram * GRAMS_PER_OUNCE : kcalPerGram }
export function inputToKcalPerGram(input: number, unit: WeightUnit): number { return unit === 'oz' ? input / GRAMS_PER_OUNCE : input }

function band(mode: TargetMode, min: number | null, max: number | null, fmt: (n: number) => string): string {
  if (mode === 'off') return ''
  if (mode === 'min') return min != null ? `>= ${fmt(min)}` : ''
  if (mode === 'max') return max != null ? `<= ${fmt(max)}` : ''
  return min != null && max != null ? `${fmt(min)} - ${fmt(max)}` : ''
}
// One decimal, trailing zero trimmed: 30 -> "30", 30.5 -> "30.5". Storage is
// numeric and the nutrition cells show decimals, so do NOT flatten fractional
// targets to integers with Math.round.
function trimNum(n: number): string { return String(Number(n.toFixed(1))) }
export function formatDailyTargetBand(metric: DailyTargetMetric, mode: TargetMode, min: number | null, max: number | null, unit: WeightUnit): string {
  if (metric === 'calorie_density') return band(mode, min, max, (n) => unit === 'oz' ? `${(n * GRAMS_PER_OUNCE).toFixed(1)} kcal/oz` : `${n.toFixed(2)} kcal/g`)
  const suffix = metric === 'calories' ? ' kcal' : metric === 'sodium' ? ' mg' : ' g'
  return band(mode, min, max, (n) => `${trimNum(n)}${suffix}`)
}
export function formatMealTargetBand(metric: MealTargetMetric, mode: TargetMode, min: number | null, max: number | null): string {
  if (metric === 'fat_pct' || metric === 'sugar_pct') return band(mode, min, max, (n) => `${trimNum(n)}%`)
  if (metric === 'carb_protein_ratio') return band(mode, min, max, (n) => n.toFixed(2))
  const suffix = metric === 'calories' ? ' kcal' : ' g'
  return band(mode, min, max, (n) => `${trimNum(n)}${suffix}`)
}
