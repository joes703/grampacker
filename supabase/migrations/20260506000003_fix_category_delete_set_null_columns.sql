-- 20260506000002 introduced a composite FK on gear_items.category_id with
-- ON DELETE SET NULL. Postgres's default behavior nulls *all* FK columns
-- on cascade — including user_id, which is NOT NULL on gear_items. Result:
-- deleting a category with referenced gear_items fails with a NOT NULL
-- violation rather than nulling category_id and leaving the gear orphaned-
-- but-owned as intended.
--
-- Fix: use the PG 15+ column-list form `ON DELETE SET NULL (category_id)`
-- so only category_id gets nulled and user_id stays intact. Future
-- composite FKs with SET NULL semantics need this same column-list form;
-- the bare `ON DELETE SET NULL` is wrong on any composite FK whose other
-- columns are NOT NULL on the child.

alter table public.gear_items drop constraint gear_items_category_id_fkey;

alter table public.gear_items
  add constraint gear_items_category_id_fkey
  foreign key (category_id, user_id) references public.categories(id, user_id)
  on delete set null (category_id);
