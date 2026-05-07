-- Phase 21: Supabase advisor cleanup — replace owner_all + public_select_*
-- with role-and-action-specific policies. Closes 26 advisor warnings:
--   * auth_rls_initplan (6) — auth.uid() called directly per row; wrapped
--     in (select auth.uid()) for initPlan caching.
--   * multiple_permissive_policies on SELECT (~20 across the four tables).
--     The old policies had no TO clause and applied through public, which
--     fanned the SELECT-policy overlap (FOR ALL owner_all + FOR SELECT
--     public_select_*) out across every role that inherits from public:
--     anon, authenticated, and Supabase internals (authenticator,
--     dashboard_user, supabase_privileged_role, …). Explicit TO anon / TO
--     authenticated on every new policy collapses each overlap to one
--     policy per (role, action) and clears the internal roles too.
--
-- Behavior preserved exactly:
--   - anon can read public shared rows (lists.is_shared = true) and the
--     transitively-reachable list_items / gear_items / categories.
--   - authenticated users can read their own rows OR public shared rows
--     (so opening a friend's /r/:slug while signed in still works).
--   - Writes (INSERT/UPDATE/DELETE) remain owner-only.
--
-- Migration history this supersedes:
--   - 20260425000000 (profiles policies)
--   - 20260425000001 (categories_owner_all, gear_items_owner_all)
--   - 20260425000002 (lists_owner_all, lists_public_select_shared,
--                     list_items_owner_all, list_items_public_select_shared)
--   - 20260427000000 (gear_items_public_select_via_shared_list,
--                     categories_public_select_via_shared_list)
--   - 20260505000001 (profiles_self_update WITH CHECK)
--   - 20260506000002 (list_items_owner_all reshape after user_id added)
--
-- query-level owner scoping (per SECURITY.md "Defense-in-depth extras")
-- is what keeps the OR'd authenticated SELECT predicate from leaking
-- public-shared rows into private query results — fetchLists / fetchGear
-- Items / fetchCategories / fetchListItems all carry an explicit
-- user_id = <auth uid> filter. Do not weaken those.

-- ============================================================
-- profiles
-- ============================================================

drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_self_update on public.profiles;

create policy profiles_self_select on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy profiles_self_update on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ============================================================
-- categories
-- ============================================================

drop policy if exists categories_owner_all on public.categories;
drop policy if exists categories_public_select_via_shared_list on public.categories;

-- anon can read categories transitively reachable through any shared list.
create policy categories_anon_select on public.categories
  for select to anon
  using (
    exists (
      select 1
      from gear_items g
      join list_items li on li.gear_item_id = g.id
      join lists l on l.id = li.list_id
      where g.category_id = categories.id and l.is_shared = true
    )
  );

-- authenticated callers see their own categories OR public-share-reachable.
create policy categories_auth_select on public.categories
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from gear_items g
      join list_items li on li.gear_item_id = g.id
      join lists l on l.id = li.list_id
      where g.category_id = categories.id and l.is_shared = true
    )
  );

create policy categories_auth_insert on public.categories
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy categories_auth_update on public.categories
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy categories_auth_delete on public.categories
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ============================================================
-- gear_items
-- ============================================================

drop policy if exists gear_items_owner_all on public.gear_items;
drop policy if exists gear_items_public_select_via_shared_list on public.gear_items;

create policy gear_items_anon_select on public.gear_items
  for select to anon
  using (
    exists (
      select 1
      from list_items li
      join lists l on l.id = li.list_id
      where li.gear_item_id = gear_items.id and l.is_shared = true
    )
  );

create policy gear_items_auth_select on public.gear_items
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from list_items li
      join lists l on l.id = li.list_id
      where li.gear_item_id = gear_items.id and l.is_shared = true
    )
  );

create policy gear_items_auth_insert on public.gear_items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy gear_items_auth_update on public.gear_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy gear_items_auth_delete on public.gear_items
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ============================================================
-- lists
-- ============================================================

drop policy if exists lists_owner_all on public.lists;
drop policy if exists lists_public_select_shared on public.lists;

create policy lists_anon_select on public.lists
  for select to anon
  using (is_shared = true);

create policy lists_auth_select on public.lists
  for select to authenticated
  using ((select auth.uid()) = user_id or is_shared = true);

create policy lists_auth_insert on public.lists
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy lists_auth_update on public.lists
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy lists_auth_delete on public.lists
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ============================================================
-- list_items
-- ============================================================

drop policy if exists list_items_owner_all on public.list_items;
drop policy if exists list_items_public_select_shared on public.list_items;

create policy list_items_anon_select on public.list_items
  for select to anon
  using (
    exists (select 1 from lists where lists.id = list_items.list_id and lists.is_shared = true)
  );

create policy list_items_auth_select on public.list_items
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (select 1 from lists where lists.id = list_items.list_id and lists.is_shared = true)
  );

create policy list_items_auth_insert on public.list_items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy list_items_auth_update on public.list_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy list_items_auth_delete on public.list_items
  for delete to authenticated
  using ((select auth.uid()) = user_id);
