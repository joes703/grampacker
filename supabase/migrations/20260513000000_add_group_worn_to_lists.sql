-- Phase: per-list "Group worn" organization toggle.
--
-- Adds public.lists.group_worn so the worn-grouping preference travels with
-- the list (was previously a transient ListDetailPage useState). When true,
-- worn list_items are pulled out of their original categories and rendered
-- in a trailing "Worn" section in both normal and pack mode, including on
-- the public /r/<slug> share view.
--
-- NOT NULL with default false — no backfill needed; existing lists keep
-- their pre-feature behavior. Append-only column add: RLS policies, FK
-- constraints, and existing query results are unaffected.

alter table public.lists
  add column group_worn boolean not null default false;

-- duplicate_list (Phase 8 M3b) currently copies name + description from the
-- source. group_worn is a per-list organization preference, so duplicates
-- should inherit it the same way they inherit description. Without this
-- update the duplicate would silently revert to the column default (false)
-- regardless of the source's setting.

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

  select * into v_source
  from public.lists
  where id = p_source_list_id and user_id = p_user_id;
  if not found then
    raise exception 'source list not found' using errcode = 'P0002';
  end if;

  insert into public.lists (user_id, name, description, slug, sort_order, group_worn)
  values (
    p_user_id,
    v_source.name || ' (copy)',
    v_source.description,
    p_slug,
    p_sort_order,
    v_source.group_worn
  )
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
