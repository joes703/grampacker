import type { FoodItem } from '../lib/types'
import type { FoodPlanBasis } from '../../shared/food-plans'
import { projectFoodGrams } from '../../shared/food-projection'

export const MISSING_FOOD_LABEL = 'Missing food definition'

// 'calories' maps to caloriesPerServing; every other key is the FoodItem
// column of the same name. This is also the canonical iteration order.
export type NutrientKey =
  | 'calories'
  | 'fatGrams'
  | 'saturatedFatGrams'
  | 'carbsGrams'
  | 'fiberGrams'
  | 'sugarGrams'
  | 'proteinGrams'
  | 'sodiumMg'
  | 'potassiumMg'

export const NUTRIENT_KEYS: readonly NutrientKey[] = [
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

// A subtotal is a value OR an explicit incomplete marker; never a silent zero
// (I-INCOMPLETE). The marker names the foods so the UI can list them.
export type NutrientTotal =
  | { state: 'complete'; value: number }
  | { state: 'incomplete'; missingFoodIds: string[] }

export type WeightTotal =
  | { state: 'complete'; grams: number }
  | { state: 'incomplete'; missingFoodIds: string[] }

// Only the columns the totals read. Structurally satisfied by both the
// document's FoodPlanEntry and plan-view's PlanEntryView.
export type NutEntry = {
  foodItemId: string
  basis: FoodPlanBasis
  amount: number
}

// Effective servings from a preserved basis. servings -> the amount itself;
// packages -> amount x servingsPerPackage, where a null servingsPerPackage
// makes the entry UNDERIVABLE (null - the caller marks the total incomplete,
// never zero); weight -> amount / servingWeightGrams (NOT NULL > 0 in the
// schema, so always derivable).
function effectiveServings(entry: NutEntry, food: FoodItem): number | null {
  switch (entry.basis) {
    case 'servings':
      return entry.amount
    case 'packages':
      if (food.servingsPerPackage === null || food.servingsPerPackage <= 0) {
        return null
      }
      return entry.amount * food.servingsPerPackage
    case 'weight':
      return entry.amount / food.servingWeightGrams
  }
}

function foodNutrientValue(food: FoodItem, key: NutrientKey): number | null {
  if (key === 'calories') return food.caloriesPerServing
  return food[key]
}

export function nutrientTotal(
  entries: NutEntry[],
  foodById: Map<string, FoodItem>,
  key: NutrientKey,
): NutrientTotal {
  const missing = new Set<string>()
  let sum = 0
  for (const e of entries) {
    const food = foodById.get(e.foodItemId)
    if (!food) {
      missing.add(e.foodItemId)
      continue
    }
    const servings = effectiveServings(e, food)
    const v = foodNutrientValue(food, key)
    if (servings === null || v === null) {
      missing.add(e.foodItemId)
      continue
    }
    sum += servings * v
  }
  if (missing.size > 0) {
    return { state: 'incomplete', missingFoodIds: [...missing] }
  }
  return { state: 'complete', value: sum }
}

// Consumable weight over the same entries, at FULL precision (no rounding -
// I-CANONICAL: rounded display grams must never feed density). Each entry
// goes through the canonical projectFoodGrams fold so this can never drift
// from the plan/share weight math; this wrapper only adds the missing-food
// bookkeeping the projection doesn't carry.
export function totalWeight(
  entries: NutEntry[],
  foodById: Map<string, FoodItem>,
): WeightTotal {
  const missing = new Set<string>()
  let grams = 0
  for (const e of entries) {
    const food = foodById.get(e.foodItemId)
    if (!food) {
      missing.add(e.foodItemId)
      continue
    }
    const projected = projectFoodGrams([
      {
        basis: e.basis,
        amount: e.amount,
        servingWeightGrams: food.servingWeightGrams,
        servingsPerPackage: food.servingsPerPackage,
      },
    ])
    if (projected.incomplete) {
      missing.add(e.foodItemId)
      continue
    }
    grams += projected.grams
  }
  if (missing.size > 0) {
    return { state: 'incomplete', missingFoodIds: [...missing] }
  }
  return { state: 'complete', grams }
}

export function nutrientTotals(
  entries: NutEntry[],
  foodById: Map<string, FoodItem>,
): Record<NutrientKey, NutrientTotal> {
  const out = {} as Record<NutrientKey, NutrientTotal>
  for (const key of NUTRIENT_KEYS) out[key] = nutrientTotal(entries, foodById, key)
  return out
}

// kcal per gram (canonical). The display layer converts to kcal/oz; the domain
// never sees the weight unit. Null when calories or weight are unknown, or at
// zero weight.
export function calorieDensityPerGram(
  calories: NutrientTotal,
  weight: WeightTotal,
): number | null {
  if (calories.state !== 'complete' || weight.state !== 'complete' || weight.grams <= 0) {
    return null
  }
  return calories.value / weight.grams
}

export function carbProteinRatio(
  carbs: NutrientTotal,
  protein: NutrientTotal,
): number | null {
  if (carbs.state !== 'complete' || protein.state !== 'complete' || protein.value <= 0) {
    return null
  }
  return carbs.value / protein.value
}

// Calculated macro calories: fat*9 + carbs*4 + protein*4. The shared
// denominator for fat % / sugar %. Requires all inputs complete and a
// positive denominator.
export function fatPct(
  fat: NutrientTotal,
  carbs: NutrientTotal,
  protein: NutrientTotal,
): number | null {
  if (fat.state !== 'complete' || carbs.state !== 'complete' || protein.state !== 'complete') {
    return null
  }
  const macroCalories = fat.value * 9 + carbs.value * 4 + protein.value * 4
  if (macroCalories <= 0) return null
  return ((fat.value * 9) / macroCalories) * 100
}

export function sugarPct(
  sugar: NutrientTotal,
  fat: NutrientTotal,
  carbs: NutrientTotal,
  protein: NutrientTotal,
): number | null {
  if (
    sugar.state !== 'complete' ||
    fat.state !== 'complete' ||
    carbs.state !== 'complete' ||
    protein.state !== 'complete'
  ) {
    return null
  }
  const macroCalories = fat.value * 9 + carbs.value * 4 + protein.value * 4
  if (macroCalories <= 0) return null
  return ((sugar.value * 4) / macroCalories) * 100
}
