-- Revert 20260506000000_composite_fks_for_same_owner.sql.
--
-- The new list_items_owner_all WITH CHECK clause introduced infinite
-- recursion (Postgres error 42P17) on list_items inserts. The added
-- EXISTS subquery against gear_items triggered nested RLS evaluation
-- that looped — gear_items has its own policies that, when evaluated
-- in the WITH CHECK context, ended up re-entering list_items policy
-- evaluation. Symptom: every insert into list_items returned 42P17 to
-- PostgREST, breaking three real-app paths (add gear to list via
-- picker, duplicate list, CSV import).
--
-- This migration restores the pre-20260506000000 state: the original
-- list_items_owner_all policy (lists ownership only) and the original
-- single-column FK on gear_items.category_id. The UNIQUE constraint
-- on categories(id, user_id) is dropped since it was only there to
-- support the composite FK target.
--
-- Codex audit finding 3 (cross-owner FK references) remains open. The
-- right path forward is likely to add user_id to list_items and use a
-- composite FK matching the categories pattern — but that's a more
-- invasive change that deserves a fresh planning session.

-- ============================================================
-- 1. Restore list_items_owner_all to the pre-20260506000000 shape
-- ============================================================

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
  );

-- ============================================================
-- 2. Restore the single-column FK on gear_items.category_id
-- ============================================================

alter table public.gear_items
  drop constraint gear_items_category_id_fkey;

alter table public.gear_items
  add constraint gear_items_category_id_fkey
  foreign key (category_id) references public.categories(id)
  on delete set null;

-- ============================================================
-- 3. Drop the UNIQUE constraint that was only there to support the
--    composite FK target
-- ============================================================

alter table public.categories
  drop constraint categories_id_user_id_key;
