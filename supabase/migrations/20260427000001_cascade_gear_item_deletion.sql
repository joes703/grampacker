-- Realign list_items.gear_item_id with DESIGN.md:
--   gear_item_id is required, and deleting a gear_item cascades to every
--   list_item that references it (no more "(deleted item)" orphan rows).
-- Also covers the existing UX promise in the per-item Delete confirm dialog
-- ("...and remove it from every list that contains it").

-- 1. Drop the old FK (was: on delete set null)
alter table list_items drop constraint if exists list_items_gear_item_id_fkey;

-- 2. Clean up any orphan list_items that were left behind by previous SET-NULL deletes
delete from list_items where gear_item_id is null;

-- 3. Tighten the column to NOT NULL
alter table list_items alter column gear_item_id set not null;

-- 4. Re-add the FK with cascade semantics
alter table list_items
  add constraint list_items_gear_item_id_fkey
  foreign key (gear_item_id) references gear_items(id) on delete cascade;
