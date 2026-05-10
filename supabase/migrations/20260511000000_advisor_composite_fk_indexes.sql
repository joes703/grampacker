-- Supabase advisor cleanup: cover composite foreign keys introduced by the
-- owner-safety migrations.
--
-- 20260506000002 rewrote these FKs to include user_id so cross-owner FK
-- references are rejected at the schema layer:
--   gear_items(category_id, user_id) -> categories(id, user_id)
--   list_items(gear_item_id, user_id) -> gear_items(id, user_id)
--   list_items(list_id, user_id) -> lists(id, user_id)
--
-- Existing indexes covered common read paths, but not these composite FK
-- column sets in FK order. These indexes give the planner direct lookup
-- paths for FK checks and parent-row deletes/updates.

create index gear_items_category_user_idx
  on public.gear_items (category_id, user_id);

create index list_items_gear_item_user_idx
  on public.list_items (gear_item_id, user_id);

create index list_items_list_user_idx
  on public.list_items (list_id, user_id);

-- Intentionally not dropping lists_user_sort_idx here. The advisor may
-- report it unused on a tiny/low-traffic table, but it covers the live
-- fetchLists(user_id) ORDER BY sort_order, name query shape.
