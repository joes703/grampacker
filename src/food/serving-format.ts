import type { FoodItem } from '../lib/types'

// One serving descriptor shared by the library row (FoodItemRow) and the picker
// row (FoodPicker), replacing two near-duplicate local helpers. The base is the
// serving_description, or the gram weight when there is no description.
//
// Two flags reproduce both call sites without changing copy:
// - withWeight: when a description exists, also show the gram weight in parens.
//   The library row does ("Bar (60 g)"); the picker shows the bare description.
//   With no description both surfaces show the gram weight, so this flag only
//   affects the description branch. (The audit framed the picker as a pure
//   subset of the library, but it also drops this parenthetical weight, so a
//   second flag was needed to preserve output.)
// - withCalories: append " - N kcal" (library row only).
//
// The description is checked for truthiness (matching the library row's prior
// behavior). serving_description is normalized to null on save
// (FoodItemDialog: `servingDescription.trim() || null`), so the picker's prior
// `?? grams` and this truthy check are equivalent for all real data.
export function formatServingDescriptor(
  food: Pick<FoodItem, 'serving_description' | 'serving_weight_grams' | 'calories_per_serving'>,
  { withWeight, withCalories }: { withWeight: boolean; withCalories: boolean },
): string {
  const grams = `${food.serving_weight_grams} g`
  let base: string
  if (!food.serving_description) {
    base = grams
  } else {
    base = withWeight ? `${food.serving_description} (${grams})` : food.serving_description
  }
  return withCalories ? `${base} - ${food.calories_per_serving} kcal` : base
}
