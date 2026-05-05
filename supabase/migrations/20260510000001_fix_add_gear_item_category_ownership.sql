-- Phase 8 follow-up: add explicit category-ownership check to
-- add_gear_item_with_list_item.
--
-- The original 20260510000000 migration validated p_list_id ownership
-- but did not validate p_category_id. RLS is bypassed inside SECURITY
-- DEFINER, so a forged p_category_id would only be caught by the
-- composite FK on gear_items (user_id, category_id) — which fails
-- AFTER the function has started doing work and produces a less clear
-- error than an explicit "category not found" check.
--
-- This is CREATE OR REPLACE on the same function name, so applying
-- this migration on a database that already has the original function
-- swaps in the patched version. Fresh installs run both migrations in
-- order and end up with the patched version.
--
-- Atomicity note: as before, both inserts (gear_items + list_items)
-- run in a single transaction. Adding the category-ownership check
-- means a stale/invalid p_category_id now rejects up-front with
-- P0002 instead of producing a partially-completed state — which was
-- always rolled back, but the new shape fails faster and clearer.

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
  -- the caller owns the target list before writing anything.
  if not exists (
    select 1 from public.lists where id = p_list_id and user_id = p_user_id
  ) then
    raise exception 'list not found' using errcode = 'P0002';
  end if;

  -- Same defense for the optional category id. p_category_id may be
  -- null (Uncategorized) — in that case skip the check. Otherwise
  -- require ownership.
  if p_category_id is not null and not exists (
    select 1 from public.categories where id = p_category_id and user_id = p_user_id
  ) then
    raise exception 'category not found' using errcode = 'P0002';
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
