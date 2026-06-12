// Numeric resource caps shared between the UI and the import preflight.
//
// The DB constraints/triggers are the authoritative enforcement:
//   - check_gear_item_limit  (20260425000001) -> GEAR_ITEM_CAP
//   - check_list_item_limit  (20260425000002) -> LIST_ITEM_CAP
//   - per-user list limit and the weight/quantity column bounds backing
//     LIST_CAP / MAX_ITEM_WEIGHT_GRAMS / MAX_LIST_ITEM_QUANTITY.
// These constants are client-side UX guards that mirror those limits so
// the app can preflight, disable controls, and clamp drafts with a
// specific, friendly message BEFORE a write hits the DB. They do NOT
// replace the authoritative DB enforcement; keep them in sync with it.

// Max gear items in a user's inventory.
export const GEAR_ITEM_CAP = 500

// Max foods in a user's library. Mirrors check_food_item_limit
// (20260611120000). See the Food Planning technical design 13.
export const FOOD_ITEM_CAP = 1000

// Max items a single list can hold.
export const LIST_ITEM_CAP = 300

// Max lists a single user can own.
export const LIST_CAP = 100

// Upper bound (grams) for a single item's weight; drafts clamp to this.
export const MAX_ITEM_WEIGHT_GRAMS = 100000

// Upper bound for a list item's quantity; drafts clamp to this.
export const MAX_LIST_ITEM_QUANTITY = 9999

// Max characters for an item/list/gear name field (input maxLength +
// CSV-import slice).
export const MAX_NAME_LENGTH = 256

// Max characters for a description field (input maxLength + CSV-import
// slice).
export const MAX_DESC_LENGTH = 2000

// Max characters for a gear category name field.
export const MAX_CATEGORY_NAME = 128

export const FOOD_PLAN_DAY_CAP = 60
export const MEAL_DEFINITION_CAP = 20
export const FOOD_PLAN_ENTRY_CAP = 2000
// meals.name CHECK is char_length 1..128 - the Meal name input must match.
export const MEAL_NAME_MAX = 128
