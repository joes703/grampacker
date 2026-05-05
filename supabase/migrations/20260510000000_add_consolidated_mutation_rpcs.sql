-- Phase 8: consolidated mutation RPCs to collapse multi-round-trip flows.
--
-- All three functions are SECURITY DEFINER + auth.uid() guarded. Pattern
-- matches bulk_update_sort_order (20260430000000) — hard-coded user
-- check at the top, set search_path, return the row(s) the client
-- previously got from the chained PostgREST calls.
--
-- RLS does NOT apply inside SECURITY DEFINER, so every function MUST
-- explicitly verify ownership of any user-controlled id parameter
-- before writing. FK rollback would catch some cases but explicit
-- checks fail fast with clearer errors.
--
-- Slug retry stays CLIENT-SIDE: each function takes p_slug as a
-- parameter; the client's withSlugRetry wrapper catches 23505 and
-- retries with a fresh slug. Server-side retry would complicate
-- auditing without saving meaningful round-trips (collisions are rare).

-- ============================================================
-- add_gear_item_with_list_item
-- ============================================================
-- Used by /lists/:id "+ Add new item" flow. Creates a gear_items row
-- AND a list_items row referencing it, in one transaction.
-- Returns: { gear_item_id uuid, list_item_id uuid }
create or replace function public.add_gear_item_with_list_item(
  p_user_id uuid,
  p_name text,
  p_description text,
  p_weight_grams integer,
  p_category_id uuid,
  p_gear_sort_order integer,
  p_list_id uuid,
  p_list_item_sort_order integer,
  p_quantity integer,
  p_is_worn boolean,
  p_is_consumable boolean
)
returns table (gear_item_id uuid, list_item_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gear_id uuid;
  v_list_item_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- Defense in depth (RLS is bypassed inside SECURITY DEFINER): verify
  -- the caller owns the target list before writing anything. Without
  -- this, a forged p_list_id pointing at another user's list would be
  -- caught only by the (user_id, list_id) composite FK on list_items —
  -- a clear error here is preferable to relying on FK rollback.
  if not exists (
    select 1 from public.lists where id = p_list_id and user_id = p_user_id
  ) then
    raise exception 'list not found' using errcode = 'P0002';
  end if;

  insert into public.gear_items (
    user_id, name, description, weight_grams, category_id,
    cost, purchase_date, sort_order
  )
  values (
    p_user_id, p_name, p_description, p_weight_grams, p_category_id,
    null, null, p_gear_sort_order
  )
  returning id into v_gear_id;

  insert into public.list_items (
    user_id, list_id, gear_item_id, quantity,
    is_worn, is_consumable, sort_order
  )
  values (
    p_user_id, p_list_id, v_gear_id, p_quantity,
    p_is_worn, p_is_consumable, p_list_item_sort_order
  )
  returning id into v_list_item_id;

  return query select v_gear_id, v_list_item_id;
end;
$$;

revoke execute on function public.add_gear_item_with_list_item from public, anon;
grant  execute on function public.add_gear_item_with_list_item to   authenticated;

-- ============================================================
-- create_list_from_selection
-- ============================================================
-- Used by /gear "Create list from selection" multi-select flow.
-- Inserts a lists row and (optionally) bulk-inserts list_items
-- referencing the supplied gear_item_ids.
-- Returns: the inserted lists row.
--
-- Slug retry: client passes p_slug; on 23505 the client's withSlugRetry
-- catches and retries with a fresh slug.
create or replace function public.create_list_from_selection(
  p_user_id uuid,
  p_name text,
  p_description text,
  p_slug text,
  p_sort_order integer,
  p_gear_item_ids uuid[]
)
returns public.lists
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_list public.lists;
  v_owned_count integer;
  v_input_count integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- Defense in depth (RLS is bypassed inside SECURITY DEFINER): verify
  -- the caller owns every gear_item id supplied. Without this, a forged
  -- array could reference another user's gear_items — the (user_id,
  -- gear_item_id) composite FK on list_items would catch it on insert
  -- via rollback, but an up-front check fails fast and avoids creating
  -- the parent list row inside a transaction that's about to abort.
  --
  -- Note: duplicate valid uuids in p_gear_item_ids would produce a
  -- count() lower than array_length() and raise P0002. The UI
  -- assembles selections as a Set, so duplicates can't reach the wire
  -- under normal flows.
  v_input_count := coalesce(array_length(p_gear_item_ids, 1), 0);
  if v_input_count > 0 then
    select count(*) into v_owned_count
    from public.gear_items
    where id = any(p_gear_item_ids) and user_id = p_user_id;
    if v_owned_count <> v_input_count then
      raise exception 'one or more gear items not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.lists (user_id, name, description, slug, sort_order)
  values (p_user_id, p_name, p_description, p_slug, p_sort_order)
  returning * into v_list;

  if v_input_count > 0 then
    insert into public.list_items (user_id, list_id, gear_item_id, sort_order)
    select p_user_id, v_list.id, gid, ordinality - 1
    from unnest(p_gear_item_ids) with ordinality as t(gid, ordinality);
  end if;

  return v_list;
end;
$$;

revoke execute on function public.create_list_from_selection from public, anon;
grant  execute on function public.create_list_from_selection to   authenticated;

-- ============================================================
-- duplicate_list
-- ============================================================
-- Used by /lists "Duplicate" kebab action. Inserts a copy of the source
-- list (name suffixed " (copy)") and copies every list_items row from
-- source to new in one transaction.
-- Returns: the new lists row.
--
-- Source ownership is enforced ONLY by the explicit
-- `where id = p_source_list_id and user_id = p_user_id` clause below.
-- RLS does NOT apply inside SECURITY DEFINER, so it cannot be relied on
-- here — the explicit check is the actual protection.
create or replace function public.duplicate_list(
  p_user_id uuid,
  p_source_list_id uuid,
  p_slug text,
  p_sort_order integer
)
returns public.lists
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_list public.lists;
  v_source public.lists;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- Verify source ownership directly. RLS does NOT apply inside
  -- SECURITY DEFINER, so this clause is the only thing preventing a
  -- forged p_source_list_id from copying another user's list.
  select * into v_source
  from public.lists
  where id = p_source_list_id and user_id = p_user_id;
  if not found then
    raise exception 'source list not found' using errcode = 'P0002';
  end if;

  insert into public.lists (user_id, name, description, slug, sort_order)
  values (p_user_id, v_source.name || ' (copy)', v_source.description, p_slug, p_sort_order)
  returning * into v_list;

  insert into public.list_items (
    user_id, list_id, gear_item_id, quantity,
    is_worn, is_consumable, is_packed, sort_order
  )
  select
    p_user_id, v_list.id, gear_item_id, quantity,
    is_worn, is_consumable, is_packed, sort_order
  from public.list_items
  where list_id = p_source_list_id and user_id = p_user_id;

  return v_list;
end;
$$;

revoke execute on function public.duplicate_list from public, anon;
grant  execute on function public.duplicate_list to   authenticated;
