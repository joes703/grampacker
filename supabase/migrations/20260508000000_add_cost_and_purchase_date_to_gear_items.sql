-- Add display-only metadata columns to gear_items.
-- Both nullable: many items have unknown values (gifts, old gear, no
-- receipt). The UI renders null as an em dash, not 0 or epoch.
--
-- cost is numeric(10,2) — exact decimal, not float. Caps at 99,999,999.99
-- which is comfortably above any realistic gear value. The non-negative
-- check matches weight_grams' bounded sanity check; we don't bound the
-- upper end since "expensive" is subjective and the column has no
-- aggregation logic that could overflow. purchase_date is unbounded by
-- design — users may enter dates from decades ago.
alter table public.gear_items
  add column cost          numeric(10, 2) check (cost is null or cost >= 0),
  add column purchase_date date;
