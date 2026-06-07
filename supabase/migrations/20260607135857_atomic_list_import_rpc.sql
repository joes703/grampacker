-- Stage 10 / audit C-05: atomic CSV-import-into-a-new-list.
-- One transaction across categories/gear/list/list_items. SECURITY INVOKER +
-- inline auth.uid() check + RLS, matching create_list_from_selection /
-- duplicate_list post-20260514202025. search_path = '' (everything
-- schema-qualified) matching the hardened RPCs.
--
-- TS owns dedup/normalization/sort-order and passes a RESOLVED plan with
-- client-generated UUIDs for new categories/gear. This function VALIDATES
-- every symbolic reference (it does not trust the plan): each gear category_id
-- and each list_item gear_item_id must be a new id in this plan OR an existing
-- row visible to the caller under RLS.
--
-- Atomicity prevents partial writes. It does NOT serialize dedup across
-- concurrent imports (two parallel imports may each create the same "new"
-- gear); that is pre-existing, acceptable behavior.
create or replace function public.create_list_with_imported_items(
  p_user_id        uuid,
  p_name           text,
  p_slug           text,
  p_sort_order     integer,
  p_new_categories jsonb,
  p_new_gear       jsonb,
  p_list_items     jsonb
)
returns public.lists
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_list public.lists;
  v_new_cat_ids  uuid[];
  v_new_gear_ids uuid[];
  v_bad uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(array_agg((e->>'id')::uuid), '{}') into v_new_cat_ids
  from jsonb_array_elements(coalesce(p_new_categories, '[]'::jsonb)) e;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into v_new_gear_ids
  from jsonb_array_elements(coalesce(p_new_gear, '[]'::jsonb)) e;

  -- validate gear -> category references
  select (e->>'category_id')::uuid into v_bad
  from jsonb_array_elements(coalesce(p_new_gear, '[]'::jsonb)) e
  where e->>'category_id' is not null
    and not ((e->>'category_id')::uuid = any(v_new_cat_ids))
    and not exists (select 1 from public.categories c
                    where c.id = (e->>'category_id')::uuid and c.user_id = p_user_id)
  limit 1;
  if v_bad is not null then
    raise exception 'gear references unknown category %', v_bad using errcode = 'P0002';
  end if;

  -- validate list_item -> gear references
  select (e->>'gear_item_id')::uuid into v_bad
  from jsonb_array_elements(coalesce(p_list_items, '[]'::jsonb)) e
  where not ((e->>'gear_item_id')::uuid = any(v_new_gear_ids))
    and not exists (select 1 from public.gear_items g
                    where g.id = (e->>'gear_item_id')::uuid and g.user_id = p_user_id)
  limit 1;
  if v_bad is not null then
    raise exception 'list item references unknown gear item %', v_bad using errcode = 'P0002';
  end if;

  insert into public.categories (id, user_id, name, sort_order)
  select (e->>'id')::uuid, p_user_id, e->>'name', (e->>'sort_order')::int
  from jsonb_array_elements(coalesce(p_new_categories, '[]'::jsonb)) e;

  insert into public.gear_items (
    id, user_id, name, description, weight_grams, category_id,
    cost, purchase_date, status, sort_order
  )
  select
    (e->>'id')::uuid, p_user_id, e->>'name', e->>'description',
    (e->>'weight_grams')::int, nullif(e->>'category_id','')::uuid,
    nullif(e->>'cost','')::numeric, nullif(e->>'purchase_date','')::date,
    e->>'status', (e->>'sort_order')::int
  from jsonb_array_elements(coalesce(p_new_gear, '[]'::jsonb)) e;

  insert into public.lists (user_id, name, description, slug, sort_order)
  values (p_user_id, p_name, null, p_slug, p_sort_order)
  returning * into v_list;

  insert into public.list_items (
    user_id, list_id, gear_item_id, quantity, is_worn, is_consumable, sort_order
  )
  select
    p_user_id, v_list.id, (e->>'gear_item_id')::uuid, (e->>'quantity')::int,
    (e->>'is_worn')::boolean, (e->>'is_consumable')::boolean, (e->>'sort_order')::int
  from jsonb_array_elements(coalesce(p_list_items, '[]'::jsonb)) e;

  return v_list;
end;
$$;

revoke execute on function public.create_list_with_imported_items from public, anon;
grant  execute on function public.create_list_with_imported_items to   authenticated;
