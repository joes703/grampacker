-- Phase 5A: public Gear sharing reads through curated views.
--
-- RLS is row security, not column security. The earlier public-share model
-- granted anon SELECT on lists/list_items/gear_items/categories and relied on
-- client SELECT allowlists to omit owner-private columns. That was too wide for
-- Phase 5's Food-plan sharing/copy work: any Data API caller could ask the base
-- tables for columns such as gear_items.status/cost/purchase_date or
-- list_items.is_packed/is_ready on rows reachable through a shared list.
--
-- This migration makes the database boundary explicit:
--   * base Gear-list tables are owner-only for authenticated callers and have
--     no anon grant;
--   * public shared Gear reads go through security-barrier views that physically
--     omit private columns;
--   * signed-in viewers of /r/:slug use those same views, so authenticated base
--     table SELECT no longer needs the "own OR shared" branch.

-- ============================================================
-- Curated public views
-- ============================================================

create or replace view public.public_gear_lists
with (security_barrier = true, security_invoker = false)
as
select
  l.id,
  l.slug,
  l.name,
  l.description,
  l.group_worn,
  l.is_draft
from public.lists l
where l.is_shared = true;

create or replace view public.public_gear_list_items
with (security_barrier = true, security_invoker = false)
as
select
  li.id,
  li.list_id,
  li.gear_item_id,
  li.quantity,
  li.is_worn,
  li.is_consumable,
  li.sort_order,
  gi.name as gear_name,
  gi.description as gear_description,
  gi.weight_grams as gear_weight_grams,
  gi.category_id as gear_category_id
from public.list_items li
join public.lists l on l.id = li.list_id
join public.gear_items gi on gi.id = li.gear_item_id
where l.is_shared = true;

create or replace view public.public_gear_categories
with (security_barrier = true, security_invoker = false)
as
select distinct
  c.id,
  c.name,
  c.sort_order
from public.categories c
join public.gear_items gi on gi.category_id = c.id
join public.list_items li on li.gear_item_id = gi.id
join public.lists l on l.id = li.list_id
where l.is_shared = true;

-- ============================================================
-- Base-table RLS: owner-only reads on the private tables
-- ============================================================

drop policy if exists categories_anon_select on public.categories;
drop policy if exists categories_auth_select on public.categories;
drop policy if exists categories_public_select_via_shared_list on public.categories;

create policy categories_auth_select on public.categories
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists gear_items_anon_select on public.gear_items;
drop policy if exists gear_items_auth_select on public.gear_items;
drop policy if exists gear_items_public_select_via_shared_list on public.gear_items;

create policy gear_items_auth_select on public.gear_items
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists lists_anon_select on public.lists;
drop policy if exists lists_auth_select on public.lists;
drop policy if exists lists_public_select_shared on public.lists;

create policy lists_auth_select on public.lists
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists list_items_anon_select on public.list_items;
drop policy if exists list_items_auth_select on public.list_items;
drop policy if exists list_items_public_select_shared on public.list_items;

create policy list_items_auth_select on public.list_items
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- ============================================================
-- Data API grant matrix
-- ============================================================

revoke all privileges
  on table public.categories,
           public.gear_items,
           public.lists,
           public.list_items
  from public, anon, authenticated, service_role;

grant select, insert, update, delete
  on table public.categories,
           public.gear_items,
           public.lists,
           public.list_items
  to authenticated;

grant select, insert, update, delete
  on table public.categories,
           public.gear_items,
           public.lists,
           public.list_items
  to service_role;

revoke all privileges
  on table public.public_gear_lists,
           public.public_gear_list_items,
           public.public_gear_categories
  from public, anon, authenticated, service_role;

grant select
  on table public.public_gear_lists,
           public.public_gear_list_items,
           public.public_gear_categories
  to anon, authenticated, service_role;
