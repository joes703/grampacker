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
// The embedded field set has a single canonical source: EMBEDDED_GEAR_FIELDS in
// lib/types.ts. The ListItemWithGear Pick and the fan-out field gate derive from
// it at compile time. This select string is `id` (the join key) plus that tuple,
// but it MUST stay a string LITERAL: PostgREST's typed client parses the select
// at the type level to infer the row shape, so a computed `string` (e.g. via
// .join) breaks fetchListItems / fetchAllUserListItems typing. It is therefore
// kept literal here and pinned to EMBEDDED_GEAR_FIELDS by shared-projections.test.ts
// ("derives GEAR_ITEM_AUTH_SELECT from the canonical ... tuple"), so editing the
// tuple without updating this string fails that test.
export const GEAR_ITEM_AUTH_SELECT =
  'gear_item:gear_items(id, name, description, weight_grams, category_id, status)'
