import { gearItemsToCsv, listItemsToCsv, slugifyFilename } from '../csv'
import type { Category, GearItem, List, ListItemWithGear, PackingLocation } from '../types'
import type { ListFoodResponse } from '../../../shared/food'
import { buildFoodJson } from './food-json'
import { buildPackingJson } from './packing-json'

export type TakeoutInput = {
  categories: Category[]
  gearItems: GearItem[]
  lists: List[]
  // Every list's items, flattened into one array; grouped by listId below.
  // The download handler fetches these per list (each list's items may be
  // warm in the cache) and concatenates them.
  allItems: ListItemWithGear[]
  packingLocationsByListId: ReadonlyMap<string, PackingLocation[]>
  foodByListId: ReadonlyMap<string, ListFoodResponse>
}

// Builds the takeout zip's file map as { path -> text content }. Pure and
// component-free so the file set is unit-testable without rendering the
// settings page or mocking fflate. The handler strToU8-encodes each value
// and zips the result.
export function buildTakeoutFiles(input: TakeoutInput): Record<string, string> {
  const { categories, gearItems, lists, allItems, packingLocationsByListId, foodByListId } =
    input
  const files: Record<string, string> = {}
  files['gear-library.csv'] = gearItemsToCsv(gearItems, categories)
  files['food.json'] = JSON.stringify(buildFoodJson({ lists, foodByListId }), null, 2)
  files['packing.json'] = JSON.stringify(
    buildPackingJson({ lists, allItems, packingLocationsByListId, foodByListId }),
    null,
    2,
  )

  // Group items by their list once, then emit one CSV per list. A manual
  // group keeps this off Map.groupBy (avoids leaning on the lib target).
  const itemsByListId = new Map<string, ListItemWithGear[]>()
  for (const item of allItems) {
    const bucket = itemsByListId.get(item.listId)
    if (bucket) bucket.push(item)
    else itemsByListId.set(item.listId, [item])
  }

  // Slugify list names for filenames, disambiguating collisions in list
  // order: the first "Trip" is trip.csv, the next trip-2.csv. A name that
  // slugifies to empty (e.g. all punctuation) falls back to "list".
  const seen = new Map<string, number>()
  for (const list of lists) {
    const items = itemsByListId.get(list.id) ?? []
    const base = slugifyFilename(list.name)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    const filename = count === 0 ? `${base}.csv` : `${base}-${count + 1}.csv`
    files[`lists/${filename}`] = listItemsToCsv(items, categories)
  }
  return files
}

// Local-time timestamp for the zip filename, e.g. 2026-07-09T14-05-33.
// Colons are illegal in filenames on Windows, so the time uses hyphens.
// Injectable date for deterministic tests.
export function exportTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  )
}
