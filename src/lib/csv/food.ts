import type { FoodItem } from '../types'
import { toCsv } from './core'

// Serialize the food library for account takeout. Missing optional values
// render as '' (never 0): unknown stays unknown (Story 1, Story 5).
export function foodItemsToCsv(items: FoodItem[]): string {
  const rows = items.map((f) => ({
    'Food Name': f.name,
    Brand: f.brand ?? '',
    'Serving Description': f.serving_description ?? '',
    'Serving Weight (g)': f.serving_weight_grams,
    'Calories per Serving': f.calories_per_serving,
    'Servings per Package': f.servings_per_package ?? '',
    'Fat (g)': f.fat_grams ?? '',
    'Saturated Fat (g)': f.saturated_fat_grams ?? '',
    'Carbs (g)': f.carbs_grams ?? '',
    'Fiber (g)': f.fiber_grams ?? '',
    'Sugar (g)': f.sugar_grams ?? '',
    'Protein (g)': f.protein_grams ?? '',
    'Sodium (mg)': f.sodium_mg ?? '',
    'Potassium (mg)': f.potassium_mg ?? '',
    Notes: f.notes ?? '',
  }))
  return toCsv(rows)
}
