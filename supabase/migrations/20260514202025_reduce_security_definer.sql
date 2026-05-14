-- Reduce SECURITY DEFINER usage to match current Supabase guidance.
--
-- Audit outcome: of the seven public functions, three genuinely need
-- DEFINER (they act on objects the authenticated role provably cannot
-- touch) and four were DEFINER only for historical reasons that no
-- longer hold.
--
-- Kept SECURITY DEFINER (privileges the caller does not have):
--   delete_account()    -- DELETE on auth.users
--   handle_new_user()   -- INSERT into public.profiles, which has no
--                          INSERT grant for supabase_auth_admin and no
--                          INSERT RLS policy at all
--   rls_auto_enable()   -- ALTER TABLE ... ENABLE RLS needs table
--                          ownership; left untouched (event-trigger
--                          only, EXECUTE fully revoked, search_path
--                          already pinned to the unshadowable
--                          pg_catalog; tightening to '' is high-risk and
--                          low-value for an event trigger)
--
-- Converted to SECURITY INVOKER (RLS + composite FKs now enforce the
-- same ownership the inline checks did):
--   bulk_update_sort_order(...)        -- static UPDATEs since
--                                         20260501000000; no INSERT path,
--                                         no dynamic SQL
--   add_gear_item_with_list_item(...)
--   create_list_from_selection(...)
--   duplicate_list(...)
--
-- The inline auth.uid() ownership checks are KEPT in all four converted
-- functions. RLS and the composite FKs from 20260506000002 enforce the
-- same constraints, but the inline checks preserve the exact error
-- contracts (42501 'unauthorized', P0002 'list not found', etc.) and
-- are defense-in-depth if a policy is ever loosened.
--
-- search_path: every converted function and the two tightened DEFINER
-- functions move to `set search_path = ''`. With an empty search_path,
-- pg_catalog is still searched implicitly, so builtins (unnest,
-- array_length, coalesce, count, format, operators, base types) resolve
-- without qualification; every public-schema table and auth.uid() is
-- explicitly schema-qualified in the bodies below.
--
-- create or replace preserves EXECUTE grants, but each converted
-- function re-asserts `revoke from public, anon` + `grant to
-- authenticated` anyway, per the 20260507000000 lesson.

-- ============================================================
-- 1. bulk_update_sort_order -> SECURITY INVOKER
-- ============================================================
-- Highest-risk body in this migration: it previously used bare table
-- names. Every UPDATE/FROM target is now public-qualified. WHERE-clause
-- column qualifiers (categories.id, lists.user_id, ...) are range-table
-- references, not catalog lookups, so they are unaffected by
-- search_path and stay as-is.
--
-- Under INVOKER each branch's UPDATE is gated by the table's
-- *_auth_update policy (USING + WITH CHECK on auth.uid() = user_id).
-- The UPDATE only touches sort_order, so the post-image keeps user_id
-- and WITH CHECK passes. authenticated holds the UPDATE grant
-- (20260514000001). The inline `user_id = auth.uid()` filters are kept:
-- they preserve the current "silently drop non-owned rows, no error"
-- behavior exactly.

create or replace function public.bulk_update_sort_order(
  p_table text,
  p_ids uuid[],
  p_orders int[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if array_length(p_ids, 1) is distinct from array_length(p_orders, 1) then
    raise exception 'ids and orders length mismatch';
  end if;

  -- Both arrays empty -> no-op. unnest of NULL arrays returns no rows,
  -- but short-circuiting here keeps the UPDATE off the hot path.
  if array_length(p_ids, 1) is null then
    return;
  end if;

  if p_table = 'categories' then
    update public.categories
    set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where categories.id = data.id
      and categories.user_id = auth.uid();

  elsif p_table = 'list_items' then
    update public.list_items
    set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order),
         public.lists
    where list_items.id = data.id
      and lists.id = list_items.list_id
      and lists.user_id = auth.uid();

  elsif p_table = 'gear_items' then
    update public.gear_items
    set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where gear_items.id = data.id
      and gear_items.user_id = auth.uid();

  elsif p_table = 'lists' then
    update public.lists
    set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where lists.id = data.id
      and lists.user_id = auth.uid();

  else
    raise exception 'invalid table: %', p_table;
  end if;
end;
$$;

revoke execute on function public.bulk_update_sort_order from public, anon;
grant  execute on function public.bulk_update_sort_order to   authenticated;

-- ============================================================
-- 2. add_gear_item_with_list_item -> SECURITY INVOKER
-- ============================================================
-- Body was already fully public-qualified; only the security mode and
-- search_path change. Under INVOKER: the gear_items / list_items
-- INSERTs pass *_auth_insert WITH CHECK (auth.uid() = user_id), and the
-- composite FKs (list_id, user_id) and (gear_item_id, user_id) enforce
-- that the list and gear belong to p_user_id. The inline checks are
-- kept for fast, clear errors.

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

  -- Verify the caller owns the target list before writing anything.
  -- list_items_auth_insert WITH CHECK and the (list_id, user_id)
  -- composite FK also enforce this; the explicit check fails fast with
  -- a clearer error.
  if not exists (
    select 1 from public.lists where id = p_list_id and user_id = p_user_id
  ) then
    raise exception 'list not found' using errcode = 'P0002';
  end if;

  -- Same defense for the optional category id. p_category_id may be
  -- null (Uncategorized) -- in that case skip the check. Otherwise
  -- require ownership. The (category_id, user_id) composite FK on
  -- gear_items also enforces this; the explicit check fails fast with
  -- a clearer error. Reproduced from 20260510000001.
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
-- 3. create_list_from_selection -> SECURITY INVOKER
-- ============================================================
-- Body was already fully public-qualified. Under INVOKER: the lists
-- INSERT passes lists_auth_insert WITH CHECK; the bulk list_items
-- INSERT passes list_items_auth_insert WITH CHECK and the
-- (gear_item_id, user_id) composite FK enforces that every supplied
-- gear id belongs to p_user_id. The inline owned-count check is kept:
-- it fails fast (P0002) before the parent list row is inserted.

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
security invoker
set search_path = ''
as $$
declare
  v_list public.lists;
  v_owned_count integer;
  v_input_count integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- Verify the caller owns every gear_item id supplied. The
  -- (user_id, gear_item_id) composite FK on list_items also catches a
  -- forged array (via rollback), but an up-front check fails fast and
  -- avoids creating the parent list row inside a doomed transaction.
  --
  -- Duplicate valid uuids in p_gear_item_ids would produce a count()
  -- lower than array_length() and raise P0002. The UI assembles
  -- selections as a Set, so duplicates can't reach the wire normally.
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
-- 4. duplicate_list -> SECURITY INVOKER
-- ============================================================
-- Body reproduced from 20260513000000 (the group_worn revision), which
-- is the current definition. Already fully public-qualified. Under
-- INVOKER: the source SELECT is covered by lists_auth_select, the new
-- lists row by lists_auth_insert, and the copied list_items by
-- list_items_auth_select (read) + list_items_auth_insert (write); the
-- composite FKs hold because copied gear_item_ids already belonged to
-- p_user_id on the source rows. The inline source-ownership check is
-- kept for the clear P0002 error.

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

  -- Verify source ownership directly. RLS (lists_auth_select) also
  -- restricts what the caller can read, but the explicit clause keeps
  -- the clear 'source list not found' error contract.
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

-- ============================================================
-- 5. delete_account -- keep SECURITY DEFINER, tighten search_path
-- ============================================================
-- Stays DEFINER: the authenticated role has no DELETE on auth.users.
-- The body already fully qualifies auth.users and auth.uid(), so only
-- the search_path setting changes -- no body rewrite, grants untouched.

alter function public.delete_account() set search_path = '';

-- ============================================================
-- 6. handle_new_user -- keep SECURITY DEFINER, tighten search_path
-- ============================================================
-- Stays DEFINER: it fires as supabase_auth_admin, which has no INSERT
-- grant on public.profiles, and profiles has no INSERT RLS policy. The
-- body already qualifies public.profiles, so only the search_path
-- setting changes.

alter function public.handle_new_user() set search_path = '';

-- ============================================================
-- rls_auto_enable -- intentionally left as-is
-- ============================================================
-- Stays SECURITY DEFINER with search_path = 'pg_catalog'. It is
-- event-trigger only, EXECUTE is fully revoked, and pg_catalog cannot
-- be shadowed. Converting to search_path = '' would require qualifying
-- pg_event_trigger_ddl_commands() and format() as pg_catalog.* and
-- re-testing an event trigger -- high-risk, low-value. No change here.
