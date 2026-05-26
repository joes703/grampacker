// Centralized gear_item join projections used inside list_items SELECTs.
//
// Two flavors, kept apart so the public projection cannot accidentally
// inherit private columns when the authenticated one widens.
//
//   AUTH   includes `status` (advisory inventory metadata: active,
//          needs_repair, loaned_out, need_to_buy). Surfaced to the gear owner only.
//   PUBLIC omits `status` and every owner-only column (user_id,
//          sort_order, cost, purchase_date). Locked by
//          shared-projections.test.ts per SECURITY.md "Public read
//          column allowlist".
//
// Both are the *nested join substring* including the PostgREST alias
// `gear_item:` and the parenthesized column list. Embed them inside a
// list_items SELECT, e.g.
//   .select(`*, ${GEAR_ITEM_AUTH_SELECT}`)
//   .select(`id, ..., sort_order, ${GEAR_ITEM_PUBLIC_SELECT}`)
//
// Widening either constant changes the wire response for every caller
// that uses it. Treat PUBLIC as a security boundary: do not add columns
// without a SECURITY.md update.

export const GEAR_ITEM_AUTH_SELECT =
  'gear_item:gear_items(id, name, description, weight_grams, category_id, status)'

export const GEAR_ITEM_PUBLIC_SELECT =
  'gear_item:gear_items(id, name, description, weight_grams, category_id)'
