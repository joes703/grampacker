// Numeric resource caps shared between the UI and (later) import preflight.
//
// The server is the authoritative enforcement:
//   - the gear_items_user_cap DB trigger (migrations/0000_baseline.sql)
//     -> GEAR_ITEM_CAP
//   - the zod request schemas in shared/gear.ts -> the name/description/
//     weight/quantity bounds below.
// These constants are client-side UX guards that mirror those limits so
// the app can preflight, disable controls, and clamp drafts with a
// specific, friendly message BEFORE a write hits the server. They do NOT
// replace the authoritative enforcement; keep them in sync with it.
//

// The list caps are defined once in shared/lists.ts (the server's
// enforcement lives next to its request schemas; the 0004 triggers
// mirror them) and re-exported here so UI call sites keep the single
// lib/caps import the old repo established.
export { LIST_CAP, LIST_ITEM_CAP, PACKING_LOCATION_CAP } from '../../shared/lists'

// Max gear items in a user's inventory, and the category cap beside it -
// both defined once in shared/gear.ts next to the schemas that use them.
export { CATEGORY_CAP, GEAR_ITEM_CAP } from '../../shared/gear'

// Upper bound (grams) for a single item's weight; drafts clamp to this.
// Defined in shared/gear.ts next to weightGramsSchema.
export { MAX_ITEM_WEIGHT_GRAMS } from '../../shared/gear'

// Upper bound for a list item's quantity; drafts clamp to this. Consumed by
// GearItemDialog's list-context field, Quick Add, CSV import and the row's
// inline editor.
//
// RE-EXPORTED, not redeclared. This was its own `= 9999` sitting beside an
// identical one in shared/lists.ts, which is the copy the request schema and
// the DB CHECK are held to - so raising the ceiling in one place left every
// client clamp on the old bound with nothing failing.
export { MAX_LIST_ITEM_QUANTITY } from '../../shared/lists'

// Max characters for an item/list/gear name field (input maxLength +
// CSV-import slice), a description field, and a gear category name field.
// Defined in shared/gear.ts next to the request schemas they bound.
export { MAX_CATEGORY_NAME, MAX_DESC_LENGTH, MAX_NAME_LENGTH } from '../../shared/gear'
