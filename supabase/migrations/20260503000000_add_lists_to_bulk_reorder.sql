-- Add lists to the bulk_update_sort_order table whitelist.
--
-- lists has the same RLS shape as categories — direct user_id column,
-- one owner-all policy (auth.uid() = user_id) — so the new branch
-- mirrors the categories branch verbatim.
--
-- The column already exists from the initial schema migration
-- (20260425000002_lists_and_list_items.sql); this migration only
-- extends the RPC to support reordering it. The /lists cards page
-- gains drag-reorder in the same commit.

create or replace function public.bulk_update_sort_order(
  p_table text,
  p_ids uuid[],
  p_orders int[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if array_length(p_ids, 1) is distinct from array_length(p_orders, 1) then
    raise exception 'ids and orders length mismatch';
  end if;

  if array_length(p_ids, 1) is null then
    return;
  end if;

  if p_table = 'categories' then
    update categories
    set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where categories.id = data.id
      and categories.user_id = auth.uid();

  elsif p_table = 'list_items' then
    update list_items
    set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order),
         lists
    where list_items.id = data.id
      and lists.id = list_items.list_id
      and lists.user_id = auth.uid();

  elsif p_table = 'gear_items' then
    update gear_items
    set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where gear_items.id = data.id
      and gear_items.user_id = auth.uid();

  elsif p_table = 'lists' then
    update lists
    set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where lists.id = data.id
      and lists.user_id = auth.uid();

  else
    raise exception 'invalid table: %', p_table;
  end if;
end;
$$;
