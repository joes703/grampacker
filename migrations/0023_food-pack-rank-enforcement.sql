-- The ENFORCE half of food pack ranks (0022 was the EXPAND half). Ships one
-- release AFTER 0022 on purpose: by the time this applies, the live worker
-- already writes proper union arrival ranks, so the indexes constrain a
-- writer that satisfies them. Shipping enforcement with the columns left an
-- unbounded failure window - if the worker deploy failed after the migration
-- applied, the old worker's DEFAULT-0 food inserts would violate the unique
-- index on every list that already had food, 500ing food-adds until a deploy
-- succeeded (GATE 2 finding). In this sequencing the same broken-deploy
-- scenario leaves the PREVIOUS release live, which writes ranks these
-- constraints accept.
--
-- STEP 1: REPAIR BEFORE CONSTRAINING (the 0019 discipline). If a degraded
-- interval did leave old-worker inserts behind, they sit at rank 0 in
-- cohorts that may already hold a rank 0 - exactly what the unique indexes
-- below would reject at creation. Only DIRTY cohorts are touched: a cohort
-- is dirty when it holds a duplicate rank. Its rows are renumbered densely
-- in their current display order (rank, then sort_order, then id), starting
-- one past the cohort's GEAR maximum so the repaired rows keep reading
-- "after the gear" the way 0022's backfill arranged. Clean cohorts keep
-- their exact ranks, gaps included.
--
-- MATERIALIZE-FIRST, for the 0020 reason in a new costume: both the dirty
-- predicate and the ordering read pack_sort_order, the column being written,
-- and a correlated per-row evaluation against a partially-updated table is
-- exactly the self-reference 0020's header warns about. The INSERT..SELECT
-- computes every final rank in one consistent snapshot; the UPDATE then only
-- copies mapped values. No two-phase parking is needed beyond that - the
-- unique indexes do not exist yet, so transient collisions have nothing to
-- violate.
--
-- The mapping table PERSISTS (emptied, never dropped): the destructive-DDL
-- gate rejects DROP TABLE in post-baseline migrations with no scratch-table
-- exemption, so this follows the _pack_reorder_guard pattern instead -
-- declared in TRANSIENT_TABLES, asserted present and EMPTY.

CREATE TABLE `_food_rank_repair` (
  `food_item_id` text PRIMARY KEY,
  `new_rank` integer NOT NULL
) WITHOUT ROWID;--> statement-breakpoint

INSERT INTO `_food_rank_repair` (`food_item_id`, `new_rank`)
SELECT `id`,
       (SELECT coalesce(max(`li`.`pack_sort_order`), -1) + 1
          FROM `list_items` AS `li`
         WHERE `li`.`list_id` = `ranked`.`list_id`
           AND `li`.`packing_location_id` IS `ranked`.`packing_location_id`)
       + `rn`
  FROM (
    SELECT `id`, `list_id`, `packing_location_id`,
           ROW_NUMBER() OVER (
             PARTITION BY `list_id`, `packing_location_id`
             ORDER BY `pack_sort_order`, `sort_order`, `id`) - 1 AS `rn`
      FROM `list_food_items`
     WHERE (`list_id`, coalesce(`packing_location_id`, '')) IN (
       SELECT `list_id`, coalesce(`packing_location_id`, '')
         FROM `list_food_items`
        GROUP BY `list_id`, coalesce(`packing_location_id`, '')
       HAVING count(*) > count(DISTINCT `pack_sort_order`))
  ) AS `ranked`;--> statement-breakpoint

UPDATE `list_food_items`
   SET `pack_sort_order` = (
     SELECT `r`.`new_rank` FROM `_food_rank_repair` AS `r`
      WHERE `r`.`food_item_id` = `list_food_items`.`id`)
 WHERE `list_food_items`.`id` IN (SELECT `food_item_id` FROM `_food_rank_repair`);--> statement-breakpoint

DELETE FROM `_food_rank_repair`;--> statement-breakpoint

-- STEP 2: NOW CONSTRAIN. The 0018-pattern cohort unique indexes. UNIQUE is
-- load-bearing: it is what turns a lost concurrent-reorder race into a
-- rolled-back batch and a 409 instead of a silently corrupted cohort.
CREATE UNIQUE INDEX `list_food_items_pack_cohort_uq` ON `list_food_items` (`list_id`,`packing_location_id`,`pack_sort_order`);--> statement-breakpoint

-- SQLite treats every NULL as DISTINCT in a unique index, so the index above
-- does not constrain the Unassigned cohort at all. Same partial-index fix as
-- 0018.
CREATE UNIQUE INDEX `list_food_items_pack_unassigned_uq` ON `list_food_items` (`list_id`,`pack_sort_order`) WHERE `packing_location_id` IS NULL;--> statement-breakpoint

-- Range triggers, the 0019 pattern. Scratch band is -FOOD_ITEM_CAP..-1
-- (-200..-1): the food cap is 200 per list, so a full-cohort payload fits and
-- no wider payload can exist. Keep in lockstep with FOOD_ITEM_CAP in
-- shared/food.ts and PACK_RANK_MAX in shared/lists.ts
-- (scripts/pack-rank-constants.test.ts pins these copies).
--
-- Asymmetric on purpose, exactly like 0019: nothing is ever CREATED negative;
-- parking IS an update, and nothing else that updates this column can go
-- below zero. So a negative food rank was parked by an in-flight reorder, and
-- counting negatives in one cohort is an EXACT check that every park landed.
CREATE TRIGGER `list_food_items_pack_rank_range_ins`
BEFORE INSERT ON `list_food_items`
FOR EACH ROW
WHEN NEW.`pack_sort_order` < 0 OR NEW.`pack_sort_order` > 1000000000
BEGIN
  SELECT RAISE(ABORT, 'food pack_sort_order out of range (0..1000000000)');
END;--> statement-breakpoint

CREATE TRIGGER `list_food_items_pack_rank_range_upd`
BEFORE UPDATE OF `pack_sort_order` ON `list_food_items`
FOR EACH ROW
WHEN NEW.`pack_sort_order` < -200 OR NEW.`pack_sort_order` > 1000000000
BEGIN
  SELECT RAISE(ABORT, 'food pack_sort_order out of range (-200..1000000000)');
END;
