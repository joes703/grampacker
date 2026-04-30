-- Add gear_items to the bulk_update_sort_order table whitelist.
--
-- gear_items has the same RLS shape as categories — direct user_id column,
-- one owner-all policy (auth.uid() = user_id) — so the new branch mirrors
-- the categories branch verbatim.
--
-- Migrating gear-items reorder from Promise.all of single-row PATCHes to
-- this RPC removes the asymmetry where two of three reorderable tables
-- went through the bulk path and one didn't. See ADR 3 in DECISIONS.md
-- for the rationale; the inline ownership filter is the same defense-in-
-- depth pattern as categories and list_items.

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

  -- Both arrays empty → no-op. unnest of NULL arrays returns no rows, but
  -- short-circuiting here keeps the UPDATE off the hot path.
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

  else
    raise exception 'invalid table: %', p_table;
  end if;
end;
$$;
