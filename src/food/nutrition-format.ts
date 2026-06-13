import { ozToGrams, type WeightUnit } from '../lib/weight'

// grams in one ounce (~28.3495); ozToGrams(1) keeps this single-sourced.
const GRAMS_PER_OUNCE = ozToGrams(1)

// Convert canonical kcal/g to a display string in the user's weight unit.
// kcal/oz = kcal/g * grams_per_ounce.
export function formatCalorieDensity(kcalPerGram: number | null, unit: WeightUnit): string {
  if (kcalPerGram === null) return '-'
  if (unit === 'oz') return `${(kcalPerGram * GRAMS_PER_OUNCE).toFixed(1)} kcal/oz`
  return `${kcalPerGram.toFixed(2)} kcal/g`
}
