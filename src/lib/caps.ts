// Numeric resource caps shared between the UI and (later) import preflight.
//
// The server is the authoritative enforcement:
//   - the gear_items_user_cap DB trigger (migrations/0003_gear.sql)
//     -> GEAR_ITEM_CAP
//   - the zod request schemas in shared/gear.ts -> the name/description/
//     weight/quantity bounds below.
// These constants are client-side UX guards that mirror those limits so
// the app can preflight, disable controls, and clamp drafts with a
// specific, friendly message BEFORE a write hits the server. They do NOT
// replace the authoritative enforcement; keep them in sync with it.
//
// TRANSPLANT NOTE: the plan caps (FOOD_PLAN_CAP / FOOD_PLAN_DAY_CAP /
// MEAL_DEFINITION_CAP / FOOD_PLAN_ENTRY_CAP) are back with the food-plans
// slice, defined in shared/food-plans.ts (the 0008 triggers mirror them) and
// re-exported below. FOOD_ITEM_CAP landed with the food library (slice 1).

// The list caps are defined once in shared/lists.ts (the server's
// enforcement lives next to its request schemas; the 0004 triggers
// mirror them) and re-exported here so UI call sites keep the single
// lib/caps import the old repo established. FOOD_ITEM_CAP follows the same
// convention (defined in shared/food.ts, the 0007 trigger mirrors it).
export { LIST_CAP, LIST_ITEM_CAP, PACKING_LOCATION_CAP } from '../../shared/lists'
export { FOOD_ITEM_CAP } from '../../shared/food'
export {
  FOOD_PLAN_CAP,
  FOOD_PLAN_DAY_CAP,
  MEAL_DEFINITION_CAP,
  FOOD_PLAN_ENTRY_CAP,
} from '../../shared/food-plans'

// Max gear items in a user's inventory.
export const GEAR_ITEM_CAP = 500

// Upper bound (grams) for a single item's weight; drafts clamp to this.
export const MAX_ITEM_WEIGHT_GRAMS = 100000

// Upper bound for a list item's quantity; drafts clamp to this.
// (Consumed by GearItemDialog's list-context quantity field.)
export const MAX_LIST_ITEM_QUANTITY = 9999

// Max characters for an item/list/gear name field (input maxLength +
// CSV-import slice).
export const MAX_NAME_LENGTH = 256

// Max characters for a description field (input maxLength + CSV-import
// slice).
export const MAX_DESC_LENGTH = 2000

// Max characters for a gear category name field.
export const MAX_CATEGORY_NAME = 128
