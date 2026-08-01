-- P0.1: stop a cascade delete colliding with the pack-rank unique index.
--
-- THE BUG
-- -------
-- `DELETE /api/lists/:id`, account deletion, and container-item deletion all
-- fail in ordinary Pack-mode state:
--
--   UNIQUE constraint failed: list_items.list_id, list_items.pack_sort_order
--
-- `list_items.packing_location_id` is ON DELETE SET NULL, so deleting a
-- packing location drops its items into the Unassigned cohort - CARRYING THEIR
-- OLD RANKS. Those ranks are unique within the bag they came from, and say
-- nothing about Unassigned, so any overlap violates the partial unique index
-- from 0018. A list with one Unassigned item at rank 0 and one bagged item at
-- rank 0 cannot be deleted at all.
--
-- Reproduced against the real schema before this was written, and the matrix
-- below includes a control proving the fixture fails WITHOUT this trigger.
--
-- WHY A TRIGGER
-- -------------
-- The collision happens inside the FK action itself, during a cascade the
-- application never sees: deleting a LIST cascades to packing_locations, whose
-- own SET NULL then fires. There is no application code in that path to fix.
--
-- SQLite fires BEFORE DELETE triggers on rows removed by a cascade (verified;
-- foreign key actions are unaffected by recursive_triggers), so a trigger on
-- packing_locations runs for every path: list delete, account delete,
-- item-backed container delete, gear-backed container delete, and nesting.
--
-- HOW IT WORKS
-- ------------
-- Materialize every affected row's FINAL rank before moving anything, then
-- apply the mapping in two phases.
--
-- Materializing first is what makes compaction possible at all. The obvious
-- form - a correlated count(*) as a dense ordinal inside the UPDATE - is
-- self-referencing: rows already updated have had their packing_location_id
-- set to NULL, so they drop out of the count and the survivors collide, with
-- the exact UNIQUE violation this trigger exists to prevent.
--
-- The whole resulting cohort is renumbered DENSELY - destination rows first,
-- then orphans, each by its own rank. Not offset above the destination
-- maximum: with a correct backstop, offsetting silently writes a rank above
-- PACK_RANK_MAX that `sortOrderSchema` will never accept back, leaving a list
-- that renders fine and can never be reordered again. Dense means the top rank
-- is cohort_size - 1, bounded by the 300-item list cap, so pack_sort_order
-- cannot approach PACK_RANK_MAX and overflow stops being a case to handle.
--
-- The cost, accepted deliberately: sparse gaps are NOT preserved. Gaps carry
-- no user-visible meaning - the UI renders order, not rank values - and 0018's
-- own backfill already renumbers densely with ROW_NUMBER().
--
-- Two phases via the NEGATIVE scratch range 0019 reserved, because a dense
-- renumbering moves rows DOWN and a single UPDATE collides mid-statement. The
-- park values are -1-n with n bounded by the list cap, so they stay inside
-- what 0019's UPDATE range trigger permits. This is the same scratch range
-- reorderPack uses, deliberately: one idiom for "move a cohort safely".
--
-- `WHEN EXISTS` keeps this a no-op for a location with no items, which is also
-- why it composes with `packingLocations.remove()` - that path unassigns its
-- rows first, so by the time the DELETE runs there is nothing left to re-rank
-- and no double re-ranking happens.
--
-- CONCURRENCY: D1 runs a batch as one atomic transaction and serializes
-- writes, so a delete and a reorder in separate batches cannot observe each
-- other's scratch values. The one way to break that is to compose park,
-- delete, and settle into a SINGLE batch. The repo does not do that today and
-- must not start.

-- TRANSIENT. Correct only when empty: rows exist solely between the two UPDATE
-- statements below, and the same trigger deletes them. Declared in
-- scripts/check-migration-safety.mjs's TRANSIENT_TABLES, which asserts it
-- exists and is EMPTY rather than demanding a fixture row.
CREATE TABLE `_packing_location_delete_state` (
  `list_item_id` text PRIMARY KEY,
  `new_rank` integer NOT NULL
) WITHOUT ROWID;--> statement-breakpoint

CREATE TRIGGER `packing_locations_rerank_orphans`
BEFORE DELETE ON `packing_locations`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `list_items` AS `li`
  WHERE `li`.`list_id` = OLD.`list_id` AND `li`.`packing_location_id` = OLD.`id`
)
BEGIN
  SELECT CASE
    WHEN (SELECT count(*) FROM `list_items` AS `c`
           WHERE `c`.`list_id` = OLD.`list_id`
             AND (`c`.`packing_location_id` IS NULL OR `c`.`packing_location_id` = OLD.`id`)) - 1
         > 1000000000
    THEN RAISE(ABORT, 'pack_sort_order exhausted while deleting packing location')
  END;

  INSERT INTO `_packing_location_delete_state` (`list_item_id`, `new_rank`)
  SELECT * FROM (
    SELECT `x`.`id`,
           row_number() OVER (
             ORDER BY CASE WHEN `x`.`packing_location_id` IS NULL THEN 0 ELSE 1 END,
                      `x`.`pack_sort_order`, `x`.`id`) - 1
      FROM `list_items` AS `x`
     WHERE `x`.`list_id` = OLD.`list_id`
       AND (`x`.`packing_location_id` IS NULL OR `x`.`packing_location_id` = OLD.`id`)
  );

  UPDATE `list_items`
     SET `pack_sort_order` = -1 - (
           SELECT `s`.`new_rank` FROM `_packing_location_delete_state` AS `s`
            WHERE `s`.`list_item_id` = `list_items`.`id`)
   WHERE `list_items`.`id` IN (SELECT `list_item_id` FROM `_packing_location_delete_state`);

  UPDATE `list_items`
     SET `packing_location_id` = NULL,
         `pack_sort_order` = (
           SELECT `s`.`new_rank` FROM `_packing_location_delete_state` AS `s`
            WHERE `s`.`list_item_id` = `list_items`.`id`)
   WHERE `list_items`.`id` IN (SELECT `list_item_id` FROM `_packing_location_delete_state`);

  DELETE FROM `_packing_location_delete_state`
   WHERE `list_item_id` IN (SELECT `id` FROM `list_items` WHERE `list_id` = OLD.`list_id`);
END;
