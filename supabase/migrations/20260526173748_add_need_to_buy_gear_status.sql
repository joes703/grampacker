-- Add a planning status for items the user does not own yet.
--
-- gear_items.status is text + CHECK rather than a Postgres enum (matching
-- the existing schema style). Replacing the constraint widens the allowed
-- values without touching data, RLS, grants, or projections.

alter table public.gear_items
  drop constraint gear_items_status_check;

alter table public.gear_items
  add constraint gear_items_status_check
  check (status in ('active', 'needs_repair', 'loaned_out', 'need_to_buy'));
