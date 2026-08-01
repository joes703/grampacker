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
-- Orphans are OFFSET above the destination maximum while that fits inside
-- PACK_RANK_MAX, and only when it does not does the whole cohort get
-- renumbered densely. Offsetting alone is not safe - with a correct backstop it
-- silently writes a rank the client can never resubmit - and dense-always is
-- not affordable, because it rewrites the entire destination cohort on every
-- location delete. A cascade over a list at the caps then rewrites the growing
-- Unassigned cohort once per location: measured at 17,430 row changes for ONE
-- list, and about 1.9 million for an account at 100 lists, well past D1's
-- 30-second query ceiling, where it would time out and roll the whole deletion
-- back. Offset-when-it-fits keeps the common path at one write per moved row
-- and preserves sparse gaps as a side effect; the dense path stays as the
-- correctness backstop.
--
-- Measured, same fixture, offset-when-it-fits versus dense-always: 58x fewer
-- row changes.
--
-- Two phases via the NEGATIVE scratch range 0019 reserved, because a dense
-- renumbering moves rows DOWN and a single UPDATE collides mid-statement. The
-- park values are -1-n with n bounded by the list cap, so they stay inside
-- what 0019's UPDATE range trigger permits. This is the same scratch range
-- reorderPack uses, deliberately: one idiom for "move a cohort safely".
--
-- A DOOMED cohort is DELETED rather than re-ranked. When the parent list is
-- already gone - which is what a list or account cascade looks like from here,
-- because SQLite removes the parent row before applying child actions - every
-- row this trigger can see is about to be deleted by the same cascade. Moving
-- ranks around first is pure waste, and it is the waste that made a big
-- account deletion unaffordable. The rows still have to GO somewhere, though:
-- skipping outright leaves the FK's SET NULL to fire and collide, which is the
-- original bug. Verified both ways.
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
-- statements below, and the same trigger deletes them. `seq` is a small dense
-- ordinal used for the negative park slot - `new_rank` cannot serve, because on
-- the offset path it can be large enough to fall outside the reserved scratch
-- range. Declared in scripts/check-migration-safety.mjs's TRANSIENT_TABLES.
CREATE TABLE `_packing_location_delete_state` (
  `list_item_id` text PRIMARY KEY,
  `new_rank` integer NOT NULL,
  `seq` integer NOT NULL
) WITHOUT ROWID;--> statement-breakpoint

CREATE TRIGGER `packing_locations_rerank_orphans`
BEFORE DELETE ON `packing_locations`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `list_items` AS `li`
  WHERE `li`.`list_id` = OLD.`list_id` AND `li`.`packing_location_id` = OLD.`id`
)
BEGIN
  -- The parent list is ALREADY GONE, so every row here is doomed: list_items
  -- cascades from lists, and SQLite removes the parent row before applying the
  -- child actions. Delete them now instead of re-ranking rows that are about
  -- to be deleted anyway.
  --
  -- This is what keeps a big cascade linear. Re-ranking per location rewrites
  -- the whole growing Unassigned cohort each time, so an account at the schema
  -- caps (100 lists x 30 locations x 300 items) turns one DELETE into millions
  -- of row changes - past D1's 30-second query ceiling, where it would time out
  -- and roll the whole deletion back.
  DELETE FROM `list_items`
   WHERE `list_id` = OLD.`list_id`
     AND `packing_location_id` = OLD.`id`
     AND NOT EXISTS (SELECT 1 FROM `lists` WHERE `id` = OLD.`list_id`);

  INSERT INTO `_packing_location_delete_state` (`list_item_id`, `new_rank`, `seq`)
  SELECT * FROM (
    SELECT `x`.`id`,
           CASE
             WHEN (SELECT coalesce(max(`u`.`pack_sort_order`), -1) + 1
                     FROM `list_items` AS `u`
                    WHERE `u`.`list_id` = OLD.`list_id`
                      AND `u`.`packing_location_id` IS NULL)
                  + (SELECT max(`s`.`pack_sort_order`) FROM `list_items` AS `s`
                      WHERE `s`.`list_id` = OLD.`list_id`
                        AND `s`.`packing_location_id` = OLD.`id`)
                  <= 1000000000
             THEN (SELECT coalesce(max(`u`.`pack_sort_order`), -1) + 1
                     FROM `list_items` AS `u`
                    WHERE `u`.`list_id` = OLD.`list_id`
                      AND `u`.`packing_location_id` IS NULL)
                  + `x`.`pack_sort_order`
             ELSE row_number() OVER (
                    ORDER BY CASE WHEN `x`.`packing_location_id` IS NULL THEN 0 ELSE 1 END,
                             `x`.`pack_sort_order`, `x`.`id`) - 1
           END,
           row_number() OVER (
             ORDER BY CASE WHEN `x`.`packing_location_id` IS NULL THEN 0 ELSE 1 END,
                      `x`.`pack_sort_order`, `x`.`id`) - 1
      FROM `list_items` AS `x`
     WHERE `x`.`list_id` = OLD.`list_id`
       AND EXISTS (SELECT 1 FROM `lists` WHERE `id` = OLD.`list_id`)
       AND (
         `x`.`packing_location_id` = OLD.`id`
         OR (`x`.`packing_location_id` IS NULL
             AND (SELECT coalesce(max(`u`.`pack_sort_order`), -1) + 1
                    FROM `list_items` AS `u`
                   WHERE `u`.`list_id` = OLD.`list_id`
                     AND `u`.`packing_location_id` IS NULL)
                 + (SELECT max(`s`.`pack_sort_order`) FROM `list_items` AS `s`
                     WHERE `s`.`list_id` = OLD.`list_id`
                       AND `s`.`packing_location_id` = OLD.`id`)
                 > 1000000000)
       )
  );

  UPDATE `list_items`
     SET `pack_sort_order` = -1 - (
           SELECT `s`.`seq` FROM `_packing_location_delete_state` AS `s`
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
