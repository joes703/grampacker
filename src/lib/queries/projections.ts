// Centralized authenticated gear_item join projection used inside private
// list_items SELECTs. It includes `status` (advisory inventory metadata:
// active, needs_repair, loaned_out, need_to_buy), surfaced to the gear owner
// only. Public /r/:slug reads do not use this base-table join; they read from
// curated DB views that physically omit private columns.
//
// This is the *nested join substring* including the PostgREST alias
// `gear_item:` and the parenthesized column list. Embed it inside a
// private list_items SELECT, e.g.
//   .select(`*, ${GEAR_ITEM_AUTH_SELECT}`)
//
// Widening this constant changes the private list-row shape and must stay
// synchronized with lists/list-items-fan-out.ts.

export const GEAR_ITEM_AUTH_SELECT =
  'gear_item:gear_items(id, name, description, weight_grams, category_id, status)'
