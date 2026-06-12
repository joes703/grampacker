import type { EntryBasis, FoodItem } from '../types'

// Effective servings from a preserved basis (design 3.1). Throws when the basis
// needs metadata the food lacks - "unknown never becomes zero".
export function effectiveServings(
  entry: { basis: EntryBasis; amount: number },
  food: Pick<FoodItem, 'serving_weight_grams' | 'servings_per_package'>,
): number {
  switch (entry.basis) {
    case 'servings':
      return entry.amount
    case 'packages':
      if (!food.servings_per_package || food.servings_per_package <= 0) {
        throw new Error('packages basis requires servings_per_package')
      }
      return entry.amount * food.servings_per_package
    case 'weight':
      if (!food.serving_weight_grams || food.serving_weight_grams <= 0) {
        throw new Error('weight basis requires serving_weight_grams')
      }
      return entry.amount / food.serving_weight_grams
  }
}

export type NewMeal = { id: string; name: string; anchor_role: 'breakfast' | 'dinner' | null; is_default: boolean; sort_order: number }
export type NewDay = { id: string; sort_order: number }
export type NewDayMeal = { id: string; day_id: string; meal_id: string }
export type FoodPlanStructure = { meals: NewMeal[]; days: NewDay[]; dayMeals: NewDayMeal[] }

// Default FULL seed: Breakfast (anchor) / On-trail food (default, non-anchor) /
// Dinner (anchor), dayCount days, every default Meal on every day. The create
// dialog may drop cells from dayMeals before passing the structure to
// createFoodPlan (which accepts any unique valid subset). dayCount is the
// explicitly-entered number of days, independent of nights.
export function buildFoodPlanStructure(dayCount: number, mintId: () => string): FoodPlanStructure {
  const meals: NewMeal[] = [
    { id: mintId(), name: 'Breakfast', anchor_role: 'breakfast', is_default: true, sort_order: 0 },
    { id: mintId(), name: 'On-trail food', anchor_role: null, is_default: true, sort_order: 1 },
    { id: mintId(), name: 'Dinner', anchor_role: 'dinner', is_default: true, sort_order: 2 },
  ]
  const days: NewDay[] = []
  const dayMeals: NewDayMeal[] = []
  const count = Math.max(0, Math.floor(dayCount))
  for (let i = 0; i < count; i++) {
    const day: NewDay = { id: mintId(), sort_order: i }
    days.push(day)
    for (const meal of meals) dayMeals.push({ id: mintId(), day_id: day.id, meal_id: meal.id })
  }
  return { meals, days, dayMeals }
}
