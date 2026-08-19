import type { List } from '../types'
import type { ListFoodResponse } from '../../../shared/food'

// Canonical, versioned food export - same shape discipline as packing.json.
//
// Each carried item is serialized ONCE, with its slot associations as
// references. Repeating an item per slot would make anyone reading this file
// compute five times the weight for a bag of trail mix eaten across five
// lunches, which is the same trap the database schema is built to avoid.
//
// v2 (0024) added isPerMeal and unitCount to each item. Additive, but the
// version moves anyway: in v1 `quantity` WAS the carried count, and in v2 it
// is per-meal for most items. A reader that kept treating it as the total
// would under-report exactly the way the app itself did.
//
// v3 DROPS `needed` from each slot. The Skip feature it belonged to is gone -
// a meal you are not eating is simply a meal with nothing scheduled - so there
// is no longer a distinction for the export to carry. Removal, not addition,
// which is exactly why the version has to move.
export const FOOD_JSON_VERSION = 3

export type FoodJson = {
  version: number
  lists: {
    listId: string
    listName: string
    dayCount: number
    slots: { id: string; dayNumber: number; meal: string }[]
    items: {
      id: string
      name: string
      weightGrams: number
      quantity: number
      isPerMeal: boolean
      unitCount: number
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
          })),
          items: food.items.map((item) => ({
            id: item.id,
            name: item.name,
            weightGrams: item.weightGrams,
            // Both, deliberately. quantity + isPerMeal is what you AUTHORED
            // and what an import would need to restore; unitCount is what it
            // resolves to, so a reader of the export does not have to know
            // the rule to know what was in the pack.
            quantity: item.quantity,
            isPerMeal: item.isPerMeal,
            unitCount: item.unitCount,
            slotIds: item.slotIds,
          })),
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  }
}
