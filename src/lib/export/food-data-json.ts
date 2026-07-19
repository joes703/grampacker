import type { FoodItem } from '../types'
import type { FoodPlanDocument, TargetDefault } from '../queries'

// The takeout bundle's food-data.json document.
//
// Version history:
//   2 - the old app: snake_case Supabase table rows.
//   3 - this app through slice 6: { foodItems, foodPlans } with camelCase
//       documents and NO target data anywhere.
//   4 - slice 7: plan documents grew dailyTargets/mealTargets, and the
//       envelope grew top-level targetDefaults (the account-level defaults
//       the old takeout also exported). COMPAT RULE for any future reader:
//       a version-3 archive simply has no target data - treat the missing
//       arrays as empty, never as an error.
//
// foodItems duplicates food-library.csv's data on purpose: the CSV is the
// re-importable/human format, the json is the lossless machine snapshot the
// plan graphs reference by foodItemId.
//
// food_pack_state is deliberately excluded (same call as the old app):
// ephemeral trip-prep state, not portable data.
export type FoodDataJsonV4 = {
  version: 4
  foodItems: FoodItem[]
  // Full per-plan graphs: meals, days, dayMeals, entries, targets, usedByList.
  foodPlans: FoodPlanDocument[]
  targetDefaults: TargetDefault[]
}

export function buildFoodDataJson(input: {
  foodItems: FoodItem[]
  foodPlans: FoodPlanDocument[]
  targetDefaults: TargetDefault[]
}): FoodDataJsonV4 {
  return {
    version: 4,
    foodItems: input.foodItems,
    foodPlans: input.foodPlans,
    targetDefaults: input.targetDefaults,
  }
}
