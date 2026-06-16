import type { FoodItem } from '../types'
import type { FoodTakeoutData } from '../queries'

// The canonical machine-readable food snapshot inside the takeout zip.
// version 2 supersedes the old { food_items } shape (effectively v1); the
// bump lets any future tooling distinguish snapshots. food_items is composed
// in here (it is already fetched for food-library.csv). food_pack_state is
// intentionally absent - see fetchAllUserFoodData / FoodTakeoutData.
export type FoodDataDocument = { version: 2; food_items: FoodItem[] } & FoodTakeoutData

export function buildFoodDataJson(
  foodItems: FoodItem[],
  foodData: FoodTakeoutData,
): FoodDataDocument {
  return { version: 2, food_items: foodItems, ...foodData }
}
