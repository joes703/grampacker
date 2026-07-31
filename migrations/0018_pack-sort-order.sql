-- Split the packing order out of the document order.
--
-- Until now `sort_order` was the ONE item order on a list. Pack view read it
-- per location, List view read it flat, and the anonymous share read it flat -
-- so reordering inside a bag rewrote the list you had written, and moving an
-- item into a bag sent it to the bottom of List view AND to the bottom of the
-- public share link. `server/routes/shares.test.ts` asserted that as intended
-- behaviour; that assertion was the bug, written down.
--
-- `pack_sort_order` is NOT a second list-wide sequence. It is a rank within the
-- row's packing COHORT - the rows sharing (list_id, packing_location_id), with
-- a null location being the Unassigned cohort. Hence the backfill below is a
-- per-cohort ROW_NUMBER() and not a copy of `sort_order`: a list-wide pack rank
-- looks equivalent right up until a location is deleted, at which point its
-- orphans interleave into Unassigned by ranks encoding old cross-location
-- accidents rather than anything the user arranged.
--
-- Additive. ADD COLUMN needs no table rebuild, so the D1 cascade trap that bit
-- 0009 and 0016 (dropping a parent cascade-deletes children inside D1's
-- implicit transaction) does not apply here. The backfill touches no FK or key
-- column and fires no UPDATE OF trigger.

ALTER TABLE `list_items` ADD COLUMN `pack_sort_order` integer NOT NULL DEFAULT 0;--> statement-breakpoint

-- PARTITION BY groups every null-location row into one partition, which is
-- exactly the Unassigned cohort. Worn rows are ranked too - they reserve a slot
-- so that toggling worn costs no ordering write and returns the row to where it
-- was. Ranks start at 0 because committed pack ranks are always nonnegative;
-- negatives exist only transiently inside a permutation batch.
--
-- ROW_NUMBER() OVER (PARTITION BY ...) is already used by
-- migrations/0010_one-plan-per-list.sql, so D1's SQLite supports it here.
UPDATE `list_items` SET `pack_sort_order` = (
  SELECT `rn` FROM (
    SELECT `id`, ROW_NUMBER() OVER (
      PARTITION BY `list_id`, `packing_location_id`
      ORDER BY `sort_order`, `id`
    ) - 1 AS `rn`
    FROM `list_items`
  ) AS `ranked` WHERE `ranked`.`id` = `list_items`.`id`
);--> statement-breakpoint

-- Both indexes are created AFTER the backfill, deliberately: every row shares
-- the DEFAULT 0 until the UPDATE above runs, so creating them first would fail
-- on any list with two items.
--
-- UNIQUE is load-bearing, not tidiness. Validate-then-batch cannot hold the
-- rank invariant under concurrency - two reorders of one cohort planned from
-- the same read both validate, and the second commit leaves a duplicate rank.
-- With a unique index the loser violates the constraint and D1 rolls the whole
-- batch back, which the route turns into a 409.
CREATE UNIQUE INDEX `list_items_pack_cohort_uq` ON `list_items` (`list_id`,`packing_location_id`,`pack_sort_order`);--> statement-breakpoint

-- SQLite treats every NULL as DISTINCT in a unique index, so the index above
-- does not constrain the Unassigned cohort at all. Without this partial index
-- Unassigned would keep exactly the corruption the other one prevents.
CREATE UNIQUE INDEX `list_items_pack_unassigned_uq` ON `list_items` (`list_id`,`pack_sort_order`) WHERE `packing_location_id` IS NULL;
