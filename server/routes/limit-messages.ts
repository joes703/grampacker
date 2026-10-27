import { FOOD_ITEM_CAP } from '../../shared/food'
import { CATEGORY_CAP, GEAR_ITEM_CAP } from '../../shared/gear'
import { LIST_CAP, LIST_ITEM_CAP, PACKING_LOCATION_CAP } from '../../shared/lists'

// The 422 message for each row cap, written once for every route that can
// hit it.
export const LIMIT_REACHED = {
  category: `Category limit reached (${CATEGORY_CAP} per user)`,
  gearItem: `Gear item limit reached (${GEAR_ITEM_CAP} per user)`,
  list: `List limit reached (${LIST_CAP} per user)`,
  listItem: `List item limit reached (${LIST_ITEM_CAP} per list)`,
  foodItem: `Food item limit reached (${FOOD_ITEM_CAP} per list)`,
  packingLocation: `Packing location limit reached (${PACKING_LOCATION_CAP} per list)`,
} as const
