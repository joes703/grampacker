import type { List, ListItemWithGear, PackingLocation } from '../types'
import type { ListFoodResponse } from '../../../shared/food'

// Bumped to 3 when list items gained pack_sort_order, and to 4 when food
// became packable (0022): a bag's contents are the gear+food union now, and
// this file promises a LOSSLESS snapshot of how a list is organized - "which
// bag" and "where in the bag" for BOTH kinds, or the food half of the user's
// arranging silently vanishes from their own backup.
export const PACKING_DATA_VERSION = 4 as const

export type PackingData = {
  version: typeof PACKING_DATA_VERSION
  lists: {
    list: { id: string; name: string }
    locations: {
      id: string
      name: string
      sortOrder: number
      containerListItemId: string | null
    }[]
    items: {
      listItemId: string
      gearItem: { id: string; name: string }
      packingLocationId: string | null
      // Rank within this item's packing location (null location = the
      // unassigned pile). Not the list's document order - that is the CSV's
      // job, and the two are independent by design.
      packSortOrder: number
    }[]
    // The food half of the union (0022). Same rank space as the gear items:
    // merge both arrays by (packSortOrder, gear-before-food, id) to read a
    // bag the way Pack mode shows it. Food AUTHORING data (weight, qty,
    // schedule) lives in food.json; this file carries only its organization.
    foodItems: {
      foodItemId: string
      name: string
      packingLocationId: string | null
      packSortOrder: number
    }[]
  }[]
}

export function buildPackingJson(input: {
  lists: List[]
  allItems: ListItemWithGear[]
  packingLocationsByListId: ReadonlyMap<string, PackingLocation[]>
  foodByListId: ReadonlyMap<string, ListFoodResponse>
}): PackingData {
  const itemsByListId = new Map<string, ListItemWithGear[]>()
  for (const item of input.allItems) {
    const bucket = itemsByListId.get(item.listId)
    if (bucket) bucket.push(item)
    else itemsByListId.set(item.listId, [item])
  }

  return {
    version: PACKING_DATA_VERSION,
    lists: input.lists.map((list) => ({
      list: { id: list.id, name: list.name },
      locations: (input.packingLocationsByListId.get(list.id) ?? [])
        .toSorted((a, b) => a.sortOrder - b.sortOrder)
        .map(({ id, name, sortOrder, containerListItemId }) => ({
          id,
          name,
          sortOrder,
          containerListItemId,
        })),
      // Emitted in pack order, per location, so the file reads the way the
      // Pack view does rather than needing the consumer to re-sort.
      items: (itemsByListId.get(list.id) ?? [])
        .toSorted((a, b) => a.packSortOrder - b.packSortOrder)
        .map((item) => ({
          listItemId: item.id,
          gearItem: { id: item.gearItem.id, name: item.gearItem.name },
          packingLocationId: item.packingLocationId,
          packSortOrder: item.packSortOrder,
        })),
      foodItems: (input.foodByListId.get(list.id)?.items ?? [])
        .toSorted((a, b) => a.packSortOrder - b.packSortOrder)
        .map((item) => ({
          foodItemId: item.id,
          name: item.name,
          packingLocationId: item.packingLocationId,
          packSortOrder: item.packSortOrder,
        })),
    })),
  }
}
