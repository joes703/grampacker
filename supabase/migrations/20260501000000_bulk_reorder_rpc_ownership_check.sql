-- Defense-in-depth: enforce ownership inside bulk_update_sort_order.
--
-- The original migration (20260430000000_bulk_reorder_rpc.sql) trusted
-- SELECT RLS to gate which IDs a caller could ever know. That trust breaks
-- for tables with public/shared read paths: list_items has a
-- list_items_public_select_shared policy that lets ANY authenticated user
-- read the IDs of items belonging to someone else's shared list. A signed-in
-- attacker could obtain another user's IDs from a shared list and pass them
-- to this RPC to reorder another user's data.
--
-- Fix: function enforces ownership inline, per-table. The UPDATE filter
-- silently drops rows the caller doesn't own — no error surface to probe,
-- no information leak about which IDs exist.
--
-- Tables added to the whitelist must specify their ownership predicate in
-- the IF/ELSIF below. SECURITY DEFINER bypasses RLS internally so the
-- function can write across whatever policy structure each table happens
-- to have; the inline ownership check is the substitute.

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

  else
    raise exception 'invalid table: %', p_table;
  end if;
end;
$$;
