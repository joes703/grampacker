-- Phase 6: cover the four missing indexes on list_items and lists.
--
-- list_items was created in 20260425000002 with no indexes; user_id was
-- added in 20260506000002. Every query that reads or cascades through
-- list_items currently seq-scans the whole table.
--
-- lists has no covering user_id index; fetchLists scans the whole table
-- on every page load. Mirrors categories_user_sort_idx / gear_items_user_idx.
--
-- These are pure CREATE INDEX statements: no data migration, no policy
-- change, no constraint change. RLS, FKs, and query results are unchanged
-- — only the planner's options improve.

-- ============================================================
-- list_items
-- ============================================================

-- Covers AUTHED fetchListItems(user_id, list_id) ORDER BY sort_order.
-- Composite over the two predicate columns + sort column lets the planner
-- do an index range scan with no extra sort step.
create index list_items_user_list_sort_idx
  on public.list_items (user_id, list_id, sort_order);

-- Covers ANON fetchSharedListItems(list_id) ORDER BY sort_order — which
-- has no user_id predicate, so the leftmost prefix of the index above
-- is unusable here. Also covers the lists.id -> list_items.list_id
-- cascade, resetPackedForList, and the per-list-item cap trigger. Adding
-- sort_order as the second column lets the share-view query do an
-- index-ordered scan and avoid a sort step. is_packed isn't included —
-- low cardinality, and resetPackedForList writes (not reads).
create index list_items_list_sort_idx
  on public.list_items (list_id, sort_order);

-- Covers the gear_items.id -> list_items.gear_item_id cascade. Without
-- this, deleting a gear_item degrades to a seq scan to find matching
-- list_items rows.
create index list_items_gear_item_id_idx
  on public.list_items (gear_item_id);

-- ============================================================
-- lists
-- ============================================================

-- Covers fetchLists(user_id) ORDER BY sort_order, name. Mirrors
-- categories_user_sort_idx and gear_items_user_idx in shape.
create index lists_user_sort_idx
  on public.lists (user_id, sort_order, name);
