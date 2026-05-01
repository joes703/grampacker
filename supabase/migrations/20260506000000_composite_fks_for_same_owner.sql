-- Lock down cross-owner foreign-key references. Two relationships were
-- vulnerable: gear_items.category_id → categories and list_items.gear_item_id
-- → gear_items. Owner-keyed RLS on the inserting row alone didn't validate
-- that the referenced row shared the same owner; an authenticated attacker
-- with leaked IDs could craft inserts threading cross-owner FK references.
--
-- Two enforcement mechanisms, chosen per-FK based on schema shape:
-- 1. gear_items.category_id: both tables have user_id → composite FK
--    (gear_items.category_id, gear_items.user_id) references
--    categories(id, user_id). Declarative, no per-insert query overhead.
--    Requires UNIQUE(id, user_id) on categories — the PK on id alone isn't
--    sufficient for a composite FK target.
-- 2. list_items.gear_item_id: list_items has no user_id (ownership traces
--    through lists) → RLS WITH CHECK subquery on the existing owner_all
--    policy. One additional EXISTS lookup per insert/update on an indexed
--    PK; cheaper than restructuring the schema to add user_id to list_items.
--
-- Run the violator-check queries before applying. If either returns rows,
-- clean up first; this migration assumes no existing data violates.
--
-- See SECURITY.md "Cross-owner FK enforcement". Codex audit finding 3.

-- ============================================================
-- 1. Composite FK: gear_items.category_id → categories(id, user_id)
-- ============================================================

-- Add the UNIQUE that the composite FK target needs. (id, user_id) is
-- already implicitly unique since id is the PK; this just declares it
-- so Postgres permits the composite FK reference.
alter table public.categories
  add constraint categories_id_user_id_key unique (id, user_id);

-- Drop the existing single-column FK and replace with a composite FK
-- that ties category_id and user_id together. ON DELETE SET NULL on the
-- composite FK only nulls category_id (the referenced column on the
-- parent), leaving user_id intact — correct behavior for uncategorized
-- gear after a category is deleted.
alter table public.gear_items
  drop constraint gear_items_category_id_fkey;

alter table public.gear_items
  add constraint gear_items_category_id_fkey
  foreign key (category_id, user_id) references public.categories(id, user_id)
  on delete set null;

-- ============================================================
-- 2. RLS WITH CHECK subquery: list_items.gear_item_id → gear_items.user_id
-- ============================================================

-- The existing owner_all policy validates that the parent list belongs
-- to the caller. Extending the WITH CHECK to also validate that the
-- referenced gear_item belongs to the caller closes the cross-owner gap
-- without requiring a user_id column on list_items.

drop policy "list_items_owner_all" on public.list_items;

create policy "list_items_owner_all" on public.list_items
  for all
  using (
    exists (
      select 1 from public.lists
      where lists.id = list_items.list_id and lists.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lists
      where lists.id = list_items.list_id and lists.user_id = auth.uid()
    )
    and exists (
      select 1 from public.gear_items
      where gear_items.id = list_items.gear_item_id and gear_items.user_id = auth.uid()
    )
  );
