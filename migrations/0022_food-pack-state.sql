-- Food joins Pack mode as a full peer of gear: packable, bag-assignable,
-- rank-ordered. This is the EXPAND half - columns, backfill, same-list
-- triggers (0014 pattern), reorder-guard table (0019 pattern), and the
-- cascade-rerank trigger (0020 pattern). The ENFORCE half - the cohort
-- unique indexes and range triggers mirroring 0018/0019 - is migration 0023,
-- one release later; see the sequencing note below.
--
-- MIRROR, NOT ABSTRACTION - deliberately. SQL cannot be generic over a table
-- the way TypeScript can, and the no-rebuild rule forbids consolidating both
-- tables into one placement table (list_items' pack columns and their indexes
-- shipped and cannot be dropped, so a new placement table would leave live
-- unique indexes constraining writes nobody makes - two rank systems instead
-- of one). The TypeScript side is where the dedup lives: one shared reorder
-- implementation over both tables (server/repos/pack-reorder.ts).
--
-- RANK SPACE IS SHARED WITH GEAR at read time. A bag's contents are the UNION
-- of its list_items cohort and its list_food_items cohort, merged by
-- (pack_sort_order, kind, id). Each table's unique index (once 0023 lands)
-- enforces uniqueness within its own rows; a cross-table duplicate cannot
-- corrupt anything - it
-- displays by the deterministic tiebreak and dissolves on the next reorder,
-- which always rewrites the union densely. A reorder batch writes BOTH tables
-- in one D1 transaction, so a concurrent reorder of the same cohort still
-- collides on one of the two indexes and rolls the whole batch back (409).
--
-- OLD-WORKER COMPATIBLE, deliberately: this migration adds columns and
-- backfills ranks but creates NO unique indexes and NO range triggers. An old
-- worker (if the post-migration deploy fails and the previous release stays
-- live) inserts food rows at pack_sort_order DEFAULT 0; without enforcement
-- those inserts SUCCEED - duplicate ranks merely display by the deterministic
-- tiebreak until repaired. Enforcement ships in migration 0023, in a LATER
-- release, whose repair step renumbers any cohort the degraded interval
-- dirtied before creating the indexes - by which time the live worker already
-- writes proper union ranks. This is expand (0022) / enforce (0023)
-- sequencing; the GATE 2 review caught that a single-release version left an
-- unbounded failure window if the worker deploy failed after the migration
-- applied.
--
-- Additive throughout. ADD COLUMN needs no table rebuild, so the D1 cascade
-- trap that bit 0009 and 0016 does not apply. The backfill touches no FK or
-- key column and fires no UPDATE OF trigger.

ALTER TABLE `list_food_items` ADD COLUMN `is_packed` integer NOT NULL DEFAULT 0;--> statement-breakpoint

ALTER TABLE `list_food_items` ADD COLUMN `is_ready` integer NOT NULL DEFAULT 0;--> statement-breakpoint

-- Nullable with a NULL default, which is what makes ADD COLUMN with a
-- REFERENCES clause legal in SQLite. SET NULL matches list_items: deleting a
-- bag returns its food to Unassigned rather than deleting it.
ALTER TABLE `list_food_items` ADD COLUMN `packing_location_id` text REFERENCES `packing_locations`(`id`) ON DELETE SET NULL;--> statement-breakpoint

ALTER TABLE `list_food_items` ADD COLUMN `pack_sort_order` integer NOT NULL DEFAULT 0;--> statement-breakpoint

-- Per-cohort ROW_NUMBER, the 0018 pattern, OFFSET past the list's Unassigned
-- GEAR maximum. Ranks are a union space now: starting food at 0 would tie
-- every dense gear rank index-for-index and the display tiebreak would
-- interleave them (gear0, food0, gear1, food1...). Offsetting makes the
-- post-migration read "your food, appended after your gear, in the order you
-- arranged it" - which is what a user who has never seen food in Pack mode
-- should find. Every existing food row has a NULL location, so the partition
-- is effectively per list.
UPDATE `list_food_items` SET `pack_sort_order` = (
  SELECT (SELECT coalesce(max(`li`.`pack_sort_order`), -1) + 1
            FROM `list_items` AS `li`
           WHERE `li`.`list_id` = `ranked`.`list_id`
             AND `li`.`packing_location_id` IS NULL)
         + `ranked`.`rn`
    FROM (
      SELECT `id`, `list_id`, ROW_NUMBER() OVER (
        PARTITION BY `list_id`, `packing_location_id`
        ORDER BY `sort_order`, `id`
      ) - 1 AS `rn`
      FROM `list_food_items`
    ) AS `ranked` WHERE `ranked`.`id` = `list_food_items`.`id`
);--> statement-breakpoint

-- FK lookup path for the SET NULL action and the cohort reads; mirrors
-- list_items_packing_location_idx.
CREATE INDEX `list_food_items_packing_location_idx` ON `list_food_items` (`packing_location_id`);--> statement-breakpoint

-- Same-list assignment triggers, the 0014 pattern. The FK above proves the
-- location EXISTS; these prove it belongs to THIS list and THIS user, so a
-- defect in app code cannot stitch one list's food into another list's bag.
-- Same abort text as the gear pair so the repos' classifier covers both.
CREATE TRIGGER `list_food_items_location_same_list_insert`
BEFORE INSERT ON `list_food_items`
WHEN NEW.`packing_location_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `packing_locations`
                  WHERE `id` = NEW.`packing_location_id`
                    AND `list_id` = NEW.`list_id`
                    AND `user_id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'packing location does not belong to this list');
END;--> statement-breakpoint

CREATE TRIGGER `list_food_items_location_same_list_update`
BEFORE UPDATE OF `packing_location_id`, `list_id`, `user_id` ON `list_food_items`
WHEN NEW.`packing_location_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `packing_locations`
                  WHERE `id` = NEW.`packing_location_id`
                    AND `list_id` = NEW.`list_id`
                    AND `user_id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'packing location does not belong to this list');
END;--> statement-breakpoint

-- TRANSIENT. Correct only when empty: a row exists solely between the park
-- and settle statements of one reorder batch, and the same batch deletes it.
-- Separate from _pack_reorder_guard because one union reorder parks BOTH
-- tables and needs both counts checked, and the gear guard's PRIMARY KEY is
-- already the list id. Declared in scripts/check-migration-safety.mjs's
-- TRANSIENT_TABLES.
CREATE TABLE `_food_pack_reorder_guard` (
  `list_id` text PRIMARY KEY NOT NULL,
  `ok` integer NOT NULL
) WITHOUT ROWID;--> statement-breakpoint

-- Cascade rerank for food orphans, the 0020 pattern on the same event.
-- SQLite fires both BEFORE DELETE triggers on packing_locations; they touch
-- disjoint tables, so their relative order does not matter.
--
-- Same three-way structure as 0020, with the same reasoning compressed:
--   * DOOMED cohort (parent list already gone - what a list/account cascade
--     looks like from here): DELETE the rows instead of re-ranking rows the
--     same cascade is about to remove.
--   * OFFSET when the destination maximum plus the source maximum fits under
--     PACK_RANK_MAX: one write per moved row, gaps preserved.
--   * DENSE renumber of the merged cohort as the correctness backstop when
--     the offset would overflow.
-- Two phases via the negative scratch range the UPDATE trigger above permits;
-- `seq` exists because on the offset path `new_rank` can exceed the scratch
-- range. See 0020's header for the full derivation, including why the
-- materialize-first shape is required (a correlated count self-references
-- mid-update and collides).
CREATE TABLE `_food_location_delete_state` (
  `food_item_id` text PRIMARY KEY,
  `new_rank` integer NOT NULL,
  `seq` integer NOT NULL
) WITHOUT ROWID;--> statement-breakpoint

CREATE TRIGGER `packing_locations_rerank_food_orphans`
BEFORE DELETE ON `packing_locations`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `list_food_items` AS `fi`
  WHERE `fi`.`list_id` = OLD.`list_id` AND `fi`.`packing_location_id` = OLD.`id`
)
BEGIN
  DELETE FROM `list_food_items`
   WHERE `list_id` = OLD.`list_id`
     AND `packing_location_id` = OLD.`id`
     AND NOT EXISTS (SELECT 1 FROM `lists` WHERE `id` = OLD.`list_id`);

  INSERT INTO `_food_location_delete_state` (`food_item_id`, `new_rank`, `seq`)
  SELECT * FROM (
    SELECT `x`.`id`,
           CASE
             WHEN (SELECT coalesce(max(`u`.`pack_sort_order`), -1) + 1
                     FROM `list_food_items` AS `u`
                    WHERE `u`.`list_id` = OLD.`list_id`
                      AND `u`.`packing_location_id` IS NULL)
                  + (SELECT max(`s`.`pack_sort_order`) FROM `list_food_items` AS `s`
                      WHERE `s`.`list_id` = OLD.`list_id`
                        AND `s`.`packing_location_id` = OLD.`id`)
                  <= 1000000000
             THEN (SELECT coalesce(max(`u`.`pack_sort_order`), -1) + 1
                     FROM `list_food_items` AS `u`
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
      FROM `list_food_items` AS `x`
     WHERE `x`.`list_id` = OLD.`list_id`
       AND EXISTS (SELECT 1 FROM `lists` WHERE `id` = OLD.`list_id`)
       AND (
         `x`.`packing_location_id` = OLD.`id`
         OR (`x`.`packing_location_id` IS NULL
             AND (SELECT coalesce(max(`u`.`pack_sort_order`), -1) + 1
                    FROM `list_food_items` AS `u`
                   WHERE `u`.`list_id` = OLD.`list_id`
                     AND `u`.`packing_location_id` IS NULL)
                 + (SELECT max(`s`.`pack_sort_order`) FROM `list_food_items` AS `s`
                     WHERE `s`.`list_id` = OLD.`list_id`
                       AND `s`.`packing_location_id` = OLD.`id`)
                 > 1000000000)
       )
  );

  UPDATE `list_food_items`
     SET `pack_sort_order` = -1 - (
           SELECT `s`.`seq` FROM `_food_location_delete_state` AS `s`
            WHERE `s`.`food_item_id` = `list_food_items`.`id`)
   WHERE `list_food_items`.`id` IN (SELECT `food_item_id` FROM `_food_location_delete_state`);

  UPDATE `list_food_items`
     SET `packing_location_id` = NULL,
         `pack_sort_order` = (
           SELECT `s`.`new_rank` FROM `_food_location_delete_state` AS `s`
            WHERE `s`.`food_item_id` = `list_food_items`.`id`)
   WHERE `list_food_items`.`id` IN (SELECT `food_item_id` FROM `_food_location_delete_state`);

  DELETE FROM `_food_location_delete_state`
   WHERE `food_item_id` IN (SELECT `id` FROM `list_food_items` WHERE `list_id` = OLD.`list_id`);
END;
