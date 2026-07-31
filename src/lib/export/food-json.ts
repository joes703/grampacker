import type { List } from '../types'
import type { ListFoodResponse } from '../../../shared/food'

// Canonical, versioned food export - same shape discipline as packing.json.
//
// Each carried item is serialized ONCE, with its slot associations as
// references. Repeating an item per slot would make anyone reading this file
// compute five times the weight for a bag of trail mix eaten across five
// lunches, which is the same trap the database schema is built to avoid.
export const FOOD_JSON_VERSION = 1

export type FoodJson = {
  version: number
  lists: {
    listId: string
    listName: string
    dayCount: number
    slots: { id: string; dayNumber: number; meal: string; needed: boolean }[]
    items: {
      id: string
      name: string
      weightGrams: number
      quantity: number
      slotIds: string[]
    }[]
  }[]
}

export function buildFoodJson(input: {
  lists: List[]
  foodByListId: ReadonlyMap<string, ListFoodResponse>
}): FoodJson {
  return {
    version: FOOD_JSON_VERSION,
    lists: input.lists
      .map((list) => {
        const food = input.foodByListId.get(list.id)
        if (!food || (food.slots.length === 0 && food.items.length === 0)) return null
        return {
          listId: list.id,
          listName: list.name,
          dayCount: food.dayCount,
          slots: food.slots.map((slot) => ({
            id: slot.id,
            dayNumber: slot.dayNumber,
            meal: slot.meal,
            needed: slot.needed,
          })),
          items: food.items.map((item) => ({
            id: item.id,
            name: item.name,
            weightGrams: item.weightGrams,
            quantity: item.quantity,
            slotIds: item.slotIds,
          })),
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  }
}
