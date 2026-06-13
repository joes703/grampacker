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
