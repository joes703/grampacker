import type { FoodItem } from '../types'
import type { FoodPlanDocument } from '../queries'

// The takeout bundle's food-data.json document. Version 3: the old app's
// version 2 was snake_case Supabase table rows (including three targets
// tables this model doesn't have), so a version-2 reader would misread this
// shape - the version bumps rather than pretending compatibility.
//
// foodItems duplicates food-library.csv's data on purpose: the CSV is the
// re-importable/human format, the json is the lossless machine snapshot the
// plan graphs reference by foodItemId.
//
// food_pack_state is deliberately excluded (same call as the old app):
// ephemeral trip-prep state, not portable data.
export type FoodDataJsonV3 = {
  version: 3
  foodItems: FoodItem[]
  // Full per-plan graphs: meals, days, dayMeals, entries, usedByList.
  foodPlans: FoodPlanDocument[]
}

export function buildFoodDataJson(input: {
  foodItems: FoodItem[]
  foodPlans: FoodPlanDocument[]
}): FoodDataJsonV3 {
  return {
    version: 3,
    foodItems: input.foodItems,
    foodPlans: input.foodPlans,
  }
}
