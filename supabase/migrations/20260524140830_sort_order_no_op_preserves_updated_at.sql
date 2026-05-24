-- Reorder-only writes should not bump updated_at.
--
-- Symptom (visible on /lists): every list card displayed "Updated just now"
-- after any single drag-to-reorder. The page reads list.updated_at and
-- formats it relative to now(); when every reorder caused every row's
-- updated_at to tick to now(), every card showed "just now".
--
-- Root cause: the reorder path is
--   reorderLists(updates)
--     -> bulk_update_sort_order('lists', ids, orders)
--        -> UPDATE public.lists SET sort_order = data.sort_order FROM ...
-- The payload includes every row, not just the ones whose slot moved
-- (assignSortOrderSlots returns slots for every row in the reordered
-- list). PostgreSQL's BEFORE UPDATE trigger set_updated_at fires per row
-- regardless of whether the new sort_order equals the old, so every row
-- in the payload gets updated_at = now() even when only the structural
-- ordering metadata changed (or didn't change at all).
--
-- Product rule: changing only sort_order is not a content edit and should
-- not bump updated_at.
--
-- Fix is two layers, defense-in-depth:
--
-- 1. bulk_update_sort_order now skips rows whose sort_order already
--    matches the requested value. No UPDATE -> no BEFORE UPDATE trigger
--    -> updated_at preserved. This alone fixes the visible /lists symptom
--    today: assignSortOrderSlots reassigns slot indices for every row in
--    the reordered list, but after one drag most slots end up unchanged.
--    Adding the `is distinct from` predicate means only rows whose
--    sort_order genuinely changed get rewritten.
--
-- 2. set_updated_at now compares OLD and NEW after stripping updated_at
--    and sort_order from both. If nothing else differs (i.e. the only
--    change is sort_order, or there's no real diff at all), updated_at
--    is preserved at its OLD value. This catches any future path that
--    UPDATEs sort_order outside the RPC and prevents the same bug from
--    re-emerging there.
--
-- The two layers together make the contract explicit: sort_order is
-- structural metadata, never user-facing "edited time".
--
-- Security posture preserved:
--   - bulk_update_sort_order stays SECURITY INVOKER (no reintroduction of
--     DEFINER); auth.uid() ownership filter retained on every branch;
--     search_path stays empty; table names stay public-qualified; EXECUTE
--     stays revoked from public/anon and granted only to authenticated.
--   - set_updated_at stays SECURITY INVOKER (default for trigger
--     functions); search_path stays pinned to public, pg_temp from
--     20260429000000_function_hardening.

-- ============================================================
-- 1. set_updated_at: skip the bump when the only diff is sort_order
-- ============================================================
-- Implementation uses jsonb-difference so the function is generic across
-- every table that wires this trigger: profiles (no sort_order), lists,
-- list_items, gear_items. Stripping a non-existent key with jsonb '-' is
-- a no-op and does not raise, so the same body is safe for profiles.
--
-- to_jsonb(NEW) - 'updated_at' - 'sort_order'
-- captures the "everything except updated_at and sort_order" projection
-- of the row. If that projection is identical between OLD and NEW, the
-- caller either rewrote sort_order only or wrote no semantic change at
-- all; in both cases we preserve OLD.updated_at. Otherwise the row had
-- a real content/settings change and the trigger bumps to now() exactly
-- as before.
--
-- TG_OP guard: this trigger is only attached BEFORE UPDATE today, but
-- the OLD/NEW comparison would NULL-deref on INSERT or DELETE, so guard
-- defensively in case a future table wires it BEFORE INSERT OR UPDATE.
-- On INSERT we keep the previous semantics (set to now()); on anything
-- unexpected we return NEW untouched.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'updated_at' - 'sort_order')
       is distinct from
       (to_jsonb(old) - 'updated_at' - 'sort_order') then
      new.updated_at = now();
    else
      new.updated_at = old.updated_at;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.updated_at = now();
    return new;
  end if;

  return new;
end;
$$;

-- search_path was pinned in 20260429000000_function_hardening to
-- (public, pg_temp). `create or replace` preserves function attributes
-- including SET clauses, but re-assert explicitly so the contract is
-- obvious to anyone reading just this migration.
alter function public.set_updated_at()
  set search_path = public, pg_temp;

-- ============================================================
-- 2. bulk_update_sort_order: no-op filter on unchanged sort_order
-- ============================================================
-- Every UPDATE branch gains
--   and <table>.sort_order is distinct from data.sort_order
-- so rows whose sort_order already matches the requested value don't get
-- rewritten. The end-state row set is identical to before; only the
-- write count drops, which is exactly what spares updated_at.
--
-- The combination with the trigger change in section 1 is intentionally
-- redundant: even if a future caller writes a "noop" reorder payload
-- through the RPC (or somehow bypasses it but still touches only
-- sort_order), the trigger still preserves updated_at. This belt-and-
-- suspenders pattern keeps the product rule enforced regardless of
-- which write path is used.
--
-- Preserved exactly from 20260514202025_reduce_security_definer:
--   - SECURITY INVOKER (no reintroduction of DEFINER)
--   - search_path = '' (defense against unqualified-name attacks)
--   - public-qualified table names in UPDATE/FROM targets
--   - inline `user_id = auth.uid()` ownership filters per branch
--   - silent no-op behavior on non-owned rows (no error)
--   - p_table whitelist (categories, list_items, gear_items, lists)
--   - length-mismatch + empty-array guards
--   - REVOKE/GRANT contract (authenticated only, no anon/public)

create or replace function public.bulk_update_sort_order(
  p_table text,
  p_ids uuid[],
  p_orders int[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if array_length(p_ids, 1) is distinct from array_length(p_orders, 1) then
    raise exception 'ids and orders length mismatch';
  end if;

  if array_length(p_ids, 1) is null then
    return;
  end if;

  if p_table = 'categories' then
    update public.categories
    set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where categories.id = data.id
      and categories.user_id = auth.uid()
      and categories.sort_order is distinct from data.sort_order;

  elsif p_table = 'list_items' then
    update public.list_items
    set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order),
         public.lists
    where list_items.id = data.id
      and lists.id = list_items.list_id
      and lists.user_id = auth.uid()
      and list_items.sort_order is distinct from data.sort_order;

  elsif p_table = 'gear_items' then
    update public.gear_items
    set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where gear_items.id = data.id
      and gear_items.user_id = auth.uid()
      and gear_items.sort_order is distinct from data.sort_order;

  elsif p_table = 'lists' then
    update public.lists
    set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where lists.id = data.id
      and lists.user_id = auth.uid()
      and lists.sort_order is distinct from data.sort_order;

  else
    raise exception 'invalid table: %', p_table;
  end if;
end;
$$;

revoke execute on function public.bulk_update_sort_order from public, anon;
grant  execute on function public.bulk_update_sort_order to   authenticated;
