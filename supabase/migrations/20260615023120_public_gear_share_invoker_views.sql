-- Follow-up to 20260615021614_public_gear_share_views.
--
-- Supabase's security advisor flags definer-rights views as ERROR. Convert
-- the public Gear share views to SECURITY INVOKER and grant anon only the
-- column-level base privileges required to evaluate those views. Private
-- columns remain unavailable to anon at the database privilege layer.

alter view public.public_gear_lists
  set (security_barrier = true, security_invoker = true);

alter view public.public_gear_list_items
  set (security_barrier = true, security_invoker = true);

alter view public.public_gear_categories
  set (security_barrier = true, security_invoker = true);

-- Recreate anon row policies for the public columns only. Authenticated base
-- table policies remain owner-only; signed-in /r/:slug reads use the
-- anonymous public client and therefore the anon policies below.
create policy lists_anon_select on public.lists
  for select to anon
  using (is_shared = true);

create policy list_items_anon_select on public.list_items
  for select to anon
  using (
    exists (
      select 1
      from public.lists l
      where l.id = list_items.list_id and l.is_shared = true
    )
  );

create policy gear_items_anon_select on public.gear_items
  for select to anon
  using (
    exists (
      select 1
      from public.list_items li
      join public.lists l on l.id = li.list_id
      where li.gear_item_id = gear_items.id and l.is_shared = true
    )
  );

create policy categories_anon_select on public.categories
  for select to anon
  using (
    exists (
      select 1
      from public.gear_items gi
      join public.list_items li on li.gear_item_id = gi.id
      join public.lists l on l.id = li.list_id
      where gi.category_id = categories.id and l.is_shared = true
    )
  );

-- Remove the broad view grants from the prior migration. The app's public
-- helpers use an anonymous Supabase client, so anon is the only browser role
-- that needs these views. service_role keeps SELECT for diagnostics/admin.
revoke all privileges
  on table public.public_gear_lists,
           public.public_gear_list_items,
           public.public_gear_categories
  from public, anon, authenticated, service_role;

grant select
  on table public.public_gear_lists,
           public.public_gear_list_items,
           public.public_gear_categories
  to anon, service_role;

-- SECURITY INVOKER views require base-table privileges for the invoker. Grant
-- anon SELECT only on the columns the views use. Do not grant table-level
-- SELECT, and do not grant private columns such as list_items.is_packed /
-- is_ready or gear_items.status/cost/purchase_date.
grant select (id, slug, name, description, group_worn, is_draft, is_shared)
  on table public.lists
  to anon;

grant select (id, list_id, gear_item_id, quantity, is_worn, is_consumable, sort_order)
  on table public.list_items
  to anon;

grant select (id, name, description, weight_grams, category_id)
  on table public.gear_items
  to anon;

grant select (id, name, sort_order)
  on table public.categories
  to anon;
