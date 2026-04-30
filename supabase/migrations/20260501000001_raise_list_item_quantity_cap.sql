-- Raise the list_items.quantity cap from 99 to 9999.
--
-- Motivation: water and similar liquid consumables are tracked as 1-gram
-- gear items with quantity = grams of substance carried (1 g per mL of
-- water at standard conditions). A 3 L water carry needs quantity=3000;
-- the previous 99 cap silently clamped these values, throwing 23514
-- check_violations on attempts to set higher quantities.
--
-- 9999 covers up to ~10 L of water (or equivalent fuel/food masses) which
-- is well past any realistic single-trip carry. UI inputs and CSV import
-- clamp to the same value.

alter table public.list_items
  drop constraint list_items_quantity_check;

alter table public.list_items
  add constraint list_items_quantity_check check (quantity between 1 and 9999);
