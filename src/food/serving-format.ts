import { gramsToOz, type WeightUnit } from '../lib/weight'
import type { FoodItem } from '../lib/types'

// grams in one ounce (~28.3495).
const GRAMS_PER_OUNCE = 1 / gramsToOz(1)

// Serving weight in the user's unit, no fixed decimals in grams (matches
// formatItemWeight's g branch), one decimal in oz.
function servingWeight(grams: number, unit: WeightUnit): string {
  return unit === 'oz' ? `${gramsToOz(grams).toFixed(1)} oz` : `${grams} g`
}

// One serving descriptor for the library row. The base is the serving
// description, or the weight when there is no description; withWeight adds
// the weight in parens when a description exists; withCalories appends the
// per-serving calories. Ported from the old repo (camelCase here).
export function formatServingDescriptor(
  food: Pick<
    FoodItem,
    'servingDescription' | 'servingWeightGrams' | 'caloriesPerServing'
  >,
  {
    withWeight,
    withCalories,
    unit,
  }: { withWeight: boolean; withCalories: boolean; unit: WeightUnit },
): string {
  const weight = servingWeight(food.servingWeightGrams, unit)
  const base = !food.servingDescription
    ? weight
    : withWeight
      ? `${food.servingDescription} (${weight})`
      : food.servingDescription
  return withCalories ? `${base} - ${food.caloriesPerServing} kcal` : base
}

// Convert canonical kcal/g to a display string in the user's weight unit.
// kcal/oz = kcal/g * grams_per_ounce. Null (no serving weight) -> "-", but
// serving_weight_grams is NOT NULL and > 0, so density is always defined.
export function formatCalorieDensity(
  kcalPerGram: number | null,
  unit: WeightUnit,
): string {
  if (kcalPerGram === null) return '-'
  if (unit === 'oz') return `${(kcalPerGram * GRAMS_PER_OUNCE).toFixed(1)} kcal/oz`
  return `${kcalPerGram.toFixed(2)} kcal/g`
}

// kcal per gram for a food. serving_weight_grams is NOT NULL and > 0, so this
// never divides by zero.
export function calorieDensity(
  food: Pick<FoodItem, 'caloriesPerServing' | 'servingWeightGrams'>,
): number {
  return food.caloriesPerServing / food.servingWeightGrams
}

// Macro grams to a compact display: one decimal, unknown -> "-".
export function formatGrams(value: number | null): string {
  return value === null ? '-' : `${value.toFixed(1)} g`
}

// Sodium / potassium (mg) to a compact display: rounded integer, unknown ->
// "-".
export function formatMilligrams(value: number | null): string {
  return value === null ? '-' : `${Math.round(value)} mg`
}

// Carbs-to-protein ratio (a macro-balance heuristic). Either operand missing,
// or protein zero, -> null -> "-".
export function carbProteinRatio(
  food: Pick<FoodItem, 'carbsGrams' | 'proteinGrams'>,
): number | null {
  if (food.carbsGrams === null || food.proteinGrams === null) return null
  if (food.proteinGrams === 0) return null
  return food.carbsGrams / food.proteinGrams
}

export function formatRatio(value: number | null): string {
  return value === null ? '-' : value.toFixed(2)
}
