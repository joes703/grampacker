import { effectiveServings } from './basis'
import type { FoodItem } from '../types'

// 'calories' maps to calories_per_serving; every other key is the FoodItem
// column of the same name. This is also the canonical iteration order.
export type NutrientKey =
  | 'calories' | 'fat_grams' | 'saturated_fat_grams' | 'carbs_grams'
  | 'fiber_grams' | 'sugar_grams' | 'protein_grams' | 'sodium_mg' | 'potassium_mg'

export const NUTRIENT_KEYS: readonly NutrientKey[] = [
  'calories', 'fat_grams', 'saturated_fat_grams', 'carbs_grams',
  'fiber_grams', 'sugar_grams', 'protein_grams', 'sodium_mg', 'potassium_mg',
]

// A subtotal is a value OR an explicit incomplete marker; never a silent zero.
export type NutrientTotal =
  | { state: 'complete'; value: number }
  | { state: 'incomplete'; missingFoodIds: string[] }

// Weight is structurally always known (serving_weight_grams is NOT NULL); the
// ONLY way it is unknown is a missing food definition, which we surface rather
// than silently undercount.
export type WeightTotal =
  | { state: 'complete'; grams: number }
  | { state: 'incomplete'; missingFoodIds: string[] }

type NutEntry = { food_item_id: string; basis: 'servings' | 'packages' | 'weight'; amount: number }

function foodNutrientValue(food: FoodItem, key: NutrientKey): number | null {
  if (key === 'calories') return food.calories_per_serving
  return food[key]
}

export function nutrientTotal(
  entries: NutEntry[], foodById: Map<string, FoodItem>, key: NutrientKey,
): NutrientTotal {
  const missing = new Set<string>()
  let sum = 0
  for (const e of entries) {
    const food = foodById.get(e.food_item_id)
    if (!food) { missing.add(e.food_item_id); continue }
    const v = foodNutrientValue(food, key)
    if (v === null) { missing.add(e.food_item_id); continue }
    sum += effectiveServings(e, food) * v
  }
  if (missing.size > 0) return { state: 'incomplete', missingFoodIds: [...missing] }
  return { state: 'complete', value: sum }
}

export function totalWeight(entries: NutEntry[], foodById: Map<string, FoodItem>): WeightTotal {
  const missing = new Set<string>()
  let grams = 0
  for (const e of entries) {
    const food = foodById.get(e.food_item_id)
    if (!food) { missing.add(e.food_item_id); continue }
    grams += effectiveServings(e, food) * food.serving_weight_grams
  }
  if (missing.size > 0) return { state: 'incomplete', missingFoodIds: [...missing] }
  return { state: 'complete', grams }
}

export function nutrientTotals(
  entries: NutEntry[], foodById: Map<string, FoodItem>,
): Record<NutrientKey, NutrientTotal> {
  const out = {} as Record<NutrientKey, NutrientTotal>
  for (const key of NUTRIENT_KEYS) out[key] = nutrientTotal(entries, foodById, key)
  return out
}

// kcal per gram (canonical). The display layer converts to kcal/oz; the domain
// never sees the weight unit. Null when calories or weight are unknown, or at
// zero weight.
export function calorieDensityPerGram(calories: NutrientTotal, weight: WeightTotal): number | null {
  if (calories.state !== 'complete' || weight.state !== 'complete' || weight.grams <= 0) return null
  return calories.value / weight.grams
}

export function carbProteinRatio(carbs: NutrientTotal, protein: NutrientTotal): number | null {
  if (carbs.state !== 'complete' || protein.state !== 'complete' || protein.value <= 0) return null
  return carbs.value / protein.value
}

// Calculated macro calories: fat*9 + carbs*4 + protein*4. The shared denominator
// for fat % / sugar %. Requires all three complete.
export function fatPct(fat: NutrientTotal, carbs: NutrientTotal, protein: NutrientTotal): number | null {
  if (fat.state !== 'complete' || carbs.state !== 'complete' || protein.state !== 'complete') return null
  const macroCalories = fat.value * 9 + carbs.value * 4 + protein.value * 4
  if (macroCalories <= 0) return null
  return (fat.value * 9) / macroCalories * 100
}

export function sugarPct(
  sugar: NutrientTotal, fat: NutrientTotal, carbs: NutrientTotal, protein: NutrientTotal,
): number | null {
  if (sugar.state !== 'complete' || fat.state !== 'complete' || carbs.state !== 'complete' || protein.state !== 'complete') return null
  const macroCalories = fat.value * 9 + carbs.value * 4 + protein.value * 4
  if (macroCalories <= 0) return null
  return (sugar.value * 4) / macroCalories * 100
}

// Sodium per calorie, displayed as mg/kcal.
export function sodiumDensity(sodiumMg: NutrientTotal, calories: NutrientTotal): number | null {
  if (sodiumMg.state !== 'complete' || calories.state !== 'complete' || calories.value <= 0) return null
  return sodiumMg.value / calories.value
}

import type { FoodPlanView } from './view'

export type GroupSummary = {
  weight: WeightTotal
  totals: Record<NutrientKey, NutrientTotal>
  calorieDensityPerGram: number | null
}
export type DaySummary = GroupSummary & { dayId: string; dayType: 'full' | 'partial' }
export type TripSummary = {
  days: DaySummary[]
  extras: GroupSummary
  planned: GroupSummary
  packed: GroupSummary
  fullDayAverage: GroupSummary & { fullDays: number; totalDays: number }
}

function makeGroup(entries: NutEntry[], foodById: Map<string, FoodItem>): GroupSummary {
  const totals = nutrientTotals(entries, foodById)
  const weight = totalWeight(entries, foodById)
  return { weight, totals, calorieDensityPerGram: calorieDensityPerGram(totals.calories, weight) }
}

export function summarizeTrip(view: FoodPlanView, foodById: Map<string, FoodItem>): TripSummary {
  const days: DaySummary[] = view.days.map((d) => {
    const entries = d.cells.flatMap((c) => c.entries)
    return { dayId: d.day.id, dayType: d.dayType, ...makeGroup(entries, foodById) }
  })

  const plannedEntries = view.days.flatMap((d) => d.cells.flatMap((c) => c.entries))
  const planned = makeGroup(plannedEntries, foodById)
  const extras = makeGroup(view.extras, foodById)
  const packed = makeGroup([...plannedEntries, ...view.extras], foodById)

  // Full-day average from COMBINED full-day entries: per-nutrient average =
  // combined / fullDays; density = combined calories / combined weight (intensive,
  // NOT the mean of daily densities).
  const fullViews = view.days.filter((d) => d.dayType === 'full')
  const fullEntries = fullViews.flatMap((d) => d.cells.flatMap((c) => c.entries))
  const n = fullViews.length
  const combinedTotals = nutrientTotals(fullEntries, foodById)
  const combinedWeight = totalWeight(fullEntries, foodById)
  const avgTotals = {} as Record<NutrientKey, NutrientTotal>
  for (const key of NUTRIENT_KEYS) {
    const t = combinedTotals[key]
    avgTotals[key] = t.state === 'incomplete' ? t : { state: 'complete', value: n > 0 ? t.value / n : 0 }
  }
  const avgWeight: WeightTotal = combinedWeight.state === 'incomplete'
    ? combinedWeight
    : { state: 'complete', grams: n > 0 ? combinedWeight.grams / n : 0 }
  const fullDayAverage = {
    weight: avgWeight,
    totals: avgTotals,
    calorieDensityPerGram: calorieDensityPerGram(combinedTotals.calories, combinedWeight),
    fullDays: n,
    totalDays: days.length,
  }

  return { days, extras, planned, packed, fullDayAverage }
}

// A derived value distinguishes three outcomes so the UI never shows a silent
// dash for missing data: complete (a number), incomplete (inputs missing - name
// the foods), or undefined (mathematically undefined, e.g. zero denominator).
export type DerivedValue =
  | { state: 'complete'; value: number }
  | { state: 'incomplete'; missingFoodIds: string[] }
  | { state: 'undefined' }

export function derivedValue(inputs: NutrientTotal[], compute: () => number | null): DerivedValue {
  const missing = new Set<string>()
  let incomplete = false
  for (const t of inputs) {
    if (t.state === 'incomplete') { incomplete = true; for (const id of t.missingFoodIds) missing.add(id) }
  }
  if (incomplete) return { state: 'incomplete', missingFoodIds: [...missing] }
  const v = compute()
  return v === null ? { state: 'undefined' } : { state: 'complete', value: v }
}
