-- Cross-owner FK lockdown for list_items, take 2.
--
-- The first attempt (20260506000000, reverted by 20260506000001) used an
-- RLS WITH CHECK subquery on gear_items to enforce same-owner references
-- on list_items.gear_item_id. That triggered policy recursion (Postgres
-- error 42P17) because the subquery against gear_items invoked gear_items'
-- own RLS policy, looping. Symptom: every list_items insert from the app
-- failed silently.
--
-- This retry uses the schema-change-and-composite-FK approach instead.
-- Composite FKs are declarative database constraints that don't trigger
-- RLS evaluation, so the recursion path that broke the first attempt
-- isn't present. Pattern matches the gear_items.category_id → categories
-- composite FK that worked in the first attempt — re-applied here for
-- symmetry and to fully close audit finding 3 in one migration.
--
-- Steps:
-- 1. Add list_items.user_id (NOT NULL, backfilled from lists.user_id).
-- 2. Add UNIQUE(id, user_id) on lists, categories, gear_items as
--    composite-FK targets.
-- 3. Replace single-column FKs on list_items.{list_id, gear_item_id}
--    and gear_items.category_id with composite FKs anchored on user_id.
-- 4. Simplify list_items_owner_all RLS to direct auth.uid() = user_id
--    (the composite FK on list_id/user_id ensures list_items.user_id
--    always equals the parent list's user_id, so the direct check is
--    equivalent to the previous EXISTS subquery).
--
-- Run the violator-check queries before applying:
--   -- list_items.gear_item_id → gear_items same-owner (via lists)
--   select li.id, l.user_id as list_user, gi.user_id as gear_user
--   from list_items li
--   join lists l on l.id = li.list_id
--   join gear_items gi on gi.id = li.gear_item_id
--   where l.user_id <> gi.user_id;
--
--   -- gear_items.category_id → categories same-owner
--   select gi.id, gi.user_id as gear_user, c.user_id as cat_user
--   from gear_items gi
--   join categories c on c.id = gi.category_id
--   where c.user_id <> gi.user_id;
--
-- Both should return zero rows.

-- ============================================================
-- 1. list_items.user_id — column add + backfill + NOT NULL
-- ============================================================

alter table public.list_items add column user_id uuid;

update public.list_items li
set user_id = l.user_id
from public.lists l
where l.id = li.list_id;

alter table public.list_items alter column user_id set not null;

-- ============================================================
-- 2. UNIQUE(id, user_id) on the three composite-FK targets
-- ============================================================
-- (id, user_id) is already implicitly unique since id is the PK; these
-- declarations just make it satisfy the composite-FK target requirement.

alter table public.lists      add constraint lists_id_user_id_key      unique (id, user_id);
alter table public.categories add constraint categories_id_user_id_key unique (id, user_id);
alter table public.gear_items add constraint gear_items_id_user_id_key unique (id, user_id);

-- ============================================================
-- 3a. Replace gear_items.category_id FK with composite (re-applies the
--     working half of the reverted 20260506000000)
-- ============================================================

alter table public.gear_items drop constraint gear_items_category_id_fkey;

alter table public.gear_items
  add constraint gear_items_category_id_fkey
  foreign key (category_id, user_id) references public.categories(id, user_id)
  on delete set null;

-- ============================================================
-- 3b. Replace list_items.list_id FK with composite
-- ============================================================
-- ON DELETE CASCADE is preserved so deleting a list still cascades to
-- its items.

alter table public.list_items drop constraint list_items_list_id_fkey;

alter table public.list_items
  add constraint list_items_list_id_fkey
  foreign key (list_id, user_id) references public.lists(id, user_id)
  on delete cascade;

-- ============================================================
-- 3c. Replace list_items.gear_item_id FK with composite
-- ============================================================
-- The original FK (from 20260427000001) is ON DELETE CASCADE so deleting
-- a gear_item also removes every list_item that referenced it. Preserved
-- here.

alter table public.list_items drop constraint list_items_gear_item_id_fkey;

alter table public.list_items
  add constraint list_items_gear_item_id_fkey
  foreign key (gear_item_id, user_id) references public.gear_items(id, user_id)
  on delete cascade;

-- ============================================================
-- 4. Simplify list_items_owner_all to direct user_id check
-- ============================================================
-- The composite FK on (list_id, user_id) → lists(id, user_id) guarantees
-- that list_items.user_id always equals the parent list's user_id, so
-- "auth.uid() = user_id" is equivalent to the previous EXISTS subquery
-- through lists. Simpler policy, no subquery overhead, and crucially no
-- subquery against gear_items (the recursion trigger from take 1).
--
-- list_items_public_select_shared is unaffected — it doesn't reference
-- user_id and stays as-is.

drop policy "list_items_owner_all" on public.list_items;

create policy "list_items_owner_all" on public.list_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
