-- Release 2A: bound pack_sort_order, and give reorderPack a fail-loud guard.
--
-- WHY
-- ---
-- `reorderPack()` writes a permutation in two phases - park every touched row
-- on a scratch rank, then settle the finals - because SQLite enforces
-- uniqueness per STATEMENT and a direct sequence of updates collides.
--
-- The old scratch range was NEGATIVE (`-1 - i`), and its safety came entirely
-- from an invariant nothing enforced: committed ranks are never negative, so a
-- row sitting at `-1 - i` must have been parked by this batch. That made the
-- settle precondition globally correct and locally meaningless, and it is why
-- nothing else in the schema could ever bound this column.
--
-- Worse, it hid a real defect. When a concurrent reorder rewrites the cohort
-- first, EVERY park predicate and EVERY settle predicate matches zero rows.
-- Nothing violates a constraint, so nothing raises: the batch commits having
-- changed nothing and the route returns 204 claiming success. The client
-- announces the move and silently snaps back on the next refetch.
--
-- WHAT THIS DOES
-- --------------
-- Bounds the column, and RESERVES a scratch range that no ordinary writer can
-- reach - so "is this row parked?" becomes a checkable fact rather than an
-- argument made three files away.
--
--   scratch:    -300 .. -1                           (-LIST_ITEM_CAP .. -1)
--   committed:     0 .. 1000000000                   (PACK_RANK_MAX)
--
-- The scratch range is NEGATIVE, and that is load-bearing. A draft of this
-- migration put the band ABOVE PACK_RANK_MAX instead, with a strict INSERT cap
-- to keep it clean. That does not work: every arrival computes
-- `max(pack_sort_order) + 1` via an UPDATE, and import may legitimately create
-- a row at exactly PACK_RANK_MAX - so moving an item into that cohort COMMITS a
-- row at PACK_RANK_MAX + 1, inside the supposed band. A later reorder's guard
-- then counts that unrelated row and can pass while a park is missing, which is
-- the exact false-success this whole mechanism exists to stop. Verified against
-- the real schema before this was written.
--
-- Negative is safe where "above the max" is not, because EVERY writer of
-- pack_sort_order produces a nonnegative value by construction: arrivals and
-- moves use `max + 1`, `packingLocations.remove()` uses `base + i` off a
-- nonnegative base, import is bounded 0..PACK_RANK_MAX, list duplication uses a
-- dense index, and 0018's backfill uses `ROW_NUMBER() - 1`. Enumerated and
-- tested, not assumed.
--
-- The two triggers are therefore ASYMMETRIC on purpose:
--
--   * INSERT allows 0 .. PACK_RANK_MAX. Nothing is ever CREATED negative.
--   * UPDATE additionally allows -LIST_ITEM_CAP .. -1, because parking IS an
--     update - and nothing else that updates this column can go below zero.
--
-- So a negative row was parked by an in-flight reorder, and counting negative
-- rows in one cohort is an EXACT check that every park landed. Counting needs
-- no ids, which matters: a per-id VALUES join would breach D1's 100-parameter
-- limit at 300 items.
--
-- The scratch range is exactly LIST_ITEM_CAP wide, so a full-cohort payload
-- fits and no wider payload can exist.
--
-- Capping UPDATE at PACK_RANK_MAX also closes the silent-overflow hole: an
-- arrival into a cohort already at PACK_RANK_MAX now ABORTS loudly instead of
-- committing a rank the client can never submit back.
--
-- Additive: two triggers and one table. No `list_items` rebuild, so the D1
-- cascade trap that bit 0009 and 0016 does not apply.

-- Keep in lockstep with PACK_RANK_MAX and LIST_ITEM_CAP in `shared/lists.ts`.
-- The pre-deploy audit (.github/workflows/audit-pack-ranks.yml) probes the same
-- numbers, so a divergence fails there rather than in production.
CREATE TRIGGER `list_items_pack_rank_range_ins`
BEFORE INSERT ON `list_items`
FOR EACH ROW
WHEN NEW.`pack_sort_order` < 0 OR NEW.`pack_sort_order` > 1000000000
BEGIN
  SELECT RAISE(ABORT, 'pack_sort_order out of range (0..1000000000)');
END;--> statement-breakpoint

CREATE TRIGGER `list_items_pack_rank_range_upd`
BEFORE UPDATE OF `pack_sort_order` ON `list_items`
FOR EACH ROW
WHEN NEW.`pack_sort_order` < -300 OR NEW.`pack_sort_order` > 1000000000
BEGIN
  SELECT RAISE(ABORT, 'pack_sort_order out of range (-300..1000000000)');
END;--> statement-breakpoint

-- TRANSIENT. Correct only when empty: a row exists solely between the park and
-- settle statements of one reorder batch, and the same batch deletes it. D1
-- runs a batch as one transaction, so a failure rolls the insert back with
-- everything else and no row can survive to collide with the next reorder.
--
-- It is a table rather than a bare SELECT because a batch statement cannot
-- branch on an earlier statement's result, and a conditional UPDATE matching
-- zero rows is NOT an error in SQLite. To abort a D1 batch you have to make a
-- statement FAIL, and feeding a NULL into a NOT NULL column is how: the guard's
-- subquery yields NULL exactly when the parked count is wrong.
--
-- Declared in scripts/check-migration-safety.mjs's TRANSIENT_TABLES, which
-- asserts it exists and is EMPTY instead of demanding a fixture row.
CREATE TABLE `_pack_reorder_guard` (
  `list_id` text PRIMARY KEY NOT NULL,
  `ok` integer NOT NULL
) WITHOUT ROWID;
