-- Phase: optional per-list Ready Checks in Pack Mode.
--
-- Adds two columns:
--   public.lists.ready_checks_enabled  — list-level toggle (default off).
--   public.list_items.is_ready          — per-item ready state (default off).
--
-- Both NOT NULL with default false so existing rows backfill cleanly and
-- the column adds are invisible to callers that don't opt in. Posture is
-- the same as 20260513000000 (group_worn) and 20260516000000 (status):
-- append-only column adds, no policy changes — RLS gates inherited.
--
-- duplicate_list is rewritten to thread both new columns. Current
-- duplicate_list copies is_packed across, so we copy is_ready the same way
-- for consistency; ready_checks_enabled inherits from the source list so
-- a duplicate keeps the same pack-mode shape the user just left.

alter table public.lists
  add column ready_checks_enabled boolean not null default false;

alter table public.list_items
  add column is_ready boolean not null default false;

create or replace function public.duplicate_list(
  p_user_id uuid,
  p_source_list_id uuid,
  p_slug text,
  p_sort_order integer
)
returns public.lists
language plpgsql
security invoker
set search_path = ''
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

  insert into public.lists (
    user_id, name, description, slug, sort_order, group_worn, ready_checks_enabled
  )
  values (
    p_user_id,
    v_source.name || ' (copy)',
    v_source.description,
    p_slug,
    p_sort_order,
    v_source.group_worn,
    v_source.ready_checks_enabled
  )
  returning * into v_list;

  insert into public.list_items (
    user_id, list_id, gear_item_id, quantity,
    is_worn, is_consumable, is_packed, is_ready, sort_order
  )
  select
    p_user_id, v_list.id, gear_item_id, quantity,
    is_worn, is_consumable, is_packed, is_ready, sort_order
  from public.list_items
  where list_id = p_source_list_id and user_id = p_user_id;

  return v_list;
end;
$$;

revoke execute on function public.duplicate_list from public, anon;
grant  execute on function public.duplicate_list to   authenticated;
