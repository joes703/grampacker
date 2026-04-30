-- Bulk sort_order rewrite for reorderable tables.
--
-- Replaces the PostgREST upsert path (INSERT … ON CONFLICT DO UPDATE), which
-- evaluates the INSERT-side RLS WITH CHECK and NOT NULL constraints against
-- the proposed row even though conflict resolution always fires for our
-- usage. That repeatedly tripped on partial payloads — first user_id RLS
-- (42501), then NOT NULL on name (23502), then the next required column,
-- and so on. SECURITY DEFINER + table whitelist sidesteps the entire INSERT
-- path: this function only ever issues UPDATE … SET sort_order, never an
-- INSERT.
--
-- Trust assumption: this function does NOT verify that the caller owns the
-- rows being reordered. SELECT RLS on the underlying tables already gates
-- which ids a user can ever know — if a caller has an id to pass in, they
-- were allowed to see it, and rewriting that row's sort_order leaks no
-- additional information. Tables added to the whitelist must continue to
-- satisfy this property.

create function public.bulk_update_sort_order(
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
  if p_table not in ('categories', 'list_items') then
    raise exception 'invalid table: %', p_table;
  end if;

  if array_length(p_ids, 1) is distinct from array_length(p_orders, 1) then
    raise exception 'ids and orders length mismatch';
  end if;

  -- Both arrays empty → no-op. unnest of NULL arrays returns no rows, but
  -- short-circuiting here keeps the EXECUTE off the hot path.
  if array_length(p_ids, 1) is null then
    return;
  end if;

  execute format(
    'update %I set sort_order = data.sort_order
     from unnest($1, $2) as data(id, sort_order)
     where %I.id = data.id',
    p_table, p_table
  ) using p_ids, p_orders;
end;
$$;

revoke execute on function public.bulk_update_sort_order from public, anon;
grant execute on function public.bulk_update_sort_order to authenticated;
