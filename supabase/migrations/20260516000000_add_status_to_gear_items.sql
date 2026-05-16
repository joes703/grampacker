-- Phase: inventory-level gear status (active / needs_repair / loaned_out).
--
-- Advisory metadata only — does NOT block packing, editing, or deleting.
-- Defaults to 'active' so the column add is invisible to existing data and
-- callers that don't opt in. CHECK constraint matches the existing migration
-- style (cost in 20260508 also uses inline CHECK); Postgres ENUM types are
-- not used anywhere in this schema, so text + CHECK is the right primitive.
--
-- RLS posture is unchanged — gear_items_owner_all already gates reads and
-- writes by auth.uid() = user_id, and the new column inherits that gate
-- without any policy change. The public share path projects an explicit
-- column allowlist on the client (see PublicGearItem / shared-projections),
-- so status is excluded from anonymous responses without server changes.

alter table public.gear_items
  add column status text not null default 'active'
    check (status in ('active', 'needs_repair', 'loaned_out'));

-- add_gear_item_with_list_item inserts gear_items with all app-owned columns
-- enumerated. The Quick Add flow on /lists/:id doesn't surface status, so
-- this RPC inserts 'active' explicitly. Preserve the security posture from
-- 20260514202025: SECURITY INVOKER, search_path='', inline ownership checks
-- as defense-in-depth, and RLS/composite FKs as the real authorization gate.

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
security invoker
set search_path = ''
as $$
declare
  v_gear_id uuid;
  v_list_item_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.lists where id = p_list_id and user_id = p_user_id
  ) then
    raise exception 'list not found' using errcode = 'P0002';
  end if;

  if p_category_id is not null and not exists (
    select 1
    from public.categories
    where id = p_category_id
      and user_id = p_user_id
  ) then
    raise exception 'category not found' using errcode = 'P0002';
  end if;

  insert into public.gear_items (
    user_id, name, description, weight_grams, category_id,
    cost, purchase_date, status, sort_order
  )
  values (
    p_user_id, p_name, p_description, p_weight_grams, p_category_id,
    null, null, 'active', p_gear_sort_order
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
