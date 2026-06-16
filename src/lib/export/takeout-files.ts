import { gearItemsToCsv, foodItemsToCsv, listItemsToCsv } from '../csv'
import { buildFoodDataJson } from './food-data-json'
import type { Category, GearItem, FoodItem, List, ListItemWithGear } from '../types'
import type { FoodTakeoutData } from '../queries'

export type TakeoutInput = {
  categories: Category[]
  gearItems: GearItem[]
  foodItems: FoodItem[]
  foodData: FoodTakeoutData
  lists: List[]
  allItems: ListItemWithGear[]
}

// Builds the takeout zip's file map as { path -> text content }. Pure and
// component-free so the file set - especially food-data.json carrying the
// version 2 food-plan snapshot - is unit-testable without rendering
// SettingsPage or mocking fflate. DownloadAllData strToU8-encodes each value
// and zips the result. food_pack_state is excluded via buildFoodDataJson.
export function buildTakeoutFiles(input: TakeoutInput): Record<string, string> {
  const { categories, gearItems, foodItems, foodData, lists, allItems } = input
  const files: Record<string, string> = {}
  files['gear-library.csv'] = gearItemsToCsv(gearItems, categories)
  files['food-library.csv'] = foodItemsToCsv(foodItems)
  files['food-data.json'] = JSON.stringify(buildFoodDataJson(foodItems, foodData), null, 2)

  const itemsByListId = Map.groupBy(allItems, (item) => item.list_id)
  const seen = new Map<string, number>()
  for (const list of lists) {
    const items = itemsByListId.get(list.id) ?? []
    const base = list.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') || 'list'
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    const filename = count === 0 ? `${base}.csv` : `${base}-${count + 1}.csv`
    files[`lists/${filename}`] = listItemsToCsv(items, categories)
  }
  return files
}
