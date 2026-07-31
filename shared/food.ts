// Food estimate limits, shared by the client (friendly guards) and mirrored by
// the migration triggers (the single enforcement point).
//
// This is NOT the old food domain. That was deleted in migration 0016 - ten
// tables, nutrition, targets, reusable plans, a library. This file exists for a
// food WEIGHT ESTIMATE attached to one list, and it should stay this small.

// Trip length ceiling. Enforced by the day_number CHECK on list_food_slots
// rather than a row-count trigger: that table holds three rows per day, so a
// count-based cap of 30 would silently mean ten days.
export const FOOD_DAY_CAP = 30

// Carried food entries per list. Trigger-enforced in the migration, mirroring
// the LIST_ITEM_CAP convention - keep this in lockstep with the RAISE text.
export const FOOD_ITEM_CAP = 200

// n days x breakfast/lunch/dinner. The upper bound on how many slots a single
// association write may name.
export const FOOD_SLOT_CAP = FOOD_DAY_CAP * 3
