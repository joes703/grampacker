/* Row counts of every application table in D1, for `import-d1 --d1-counts`
   (runbook sections 10 and 11). Read-only. Run it with wrangler right after
   the export:
     npx wrangler d1 execute grampacker --remote --json --command "$(cat deploy/d1-row-counts.sql)"
   It returns ONE row, one column per table, because D1 refuses a compound
   SELECT (UNION ALL) of this many terms. The importer refuses counts that do
   not name exactly the tables migrations/ creates, so a table added later
   must be added here too. A block comment, not "--": wrangler would read a
   leading "--" as an option. */
SELECT
  (SELECT COUNT(*) FROM "account") AS "account",
  (SELECT COUNT(*) FROM "categories") AS "categories",
  (SELECT COUNT(*) FROM "gear_items") AS "gear_items",
  (SELECT COUNT(*) FROM "list_food_item_slots") AS "list_food_item_slots",
  (SELECT COUNT(*) FROM "list_food_items") AS "list_food_items",
  (SELECT COUNT(*) FROM "list_food_slots") AS "list_food_slots",
  (SELECT COUNT(*) FROM "list_items") AS "list_items",
  (SELECT COUNT(*) FROM "lists") AS "lists",
  (SELECT COUNT(*) FROM "packing_locations") AS "packing_locations",
  (SELECT COUNT(*) FROM "passkey") AS "passkey",
  (SELECT COUNT(*) FROM "rate_limits") AS "rate_limits",
  (SELECT COUNT(*) FROM "session") AS "session",
  (SELECT COUNT(*) FROM "user") AS "user",
  (SELECT COUNT(*) FROM "verification") AS "verification",
  (SELECT COUNT(*) FROM "_food_location_delete_state") AS "_food_location_delete_state",
  (SELECT COUNT(*) FROM "_food_pack_reorder_guard") AS "_food_pack_reorder_guard",
  (SELECT COUNT(*) FROM "_pack_reorder_guard") AS "_pack_reorder_guard",
  (SELECT COUNT(*) FROM "_packing_location_delete_state") AS "_packing_location_delete_state";
