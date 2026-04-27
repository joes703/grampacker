-- Item weight now lives only on gear_items. The list_items.weight_grams snapshot
-- created the "out of sync" footgun where editing a weight on a list silently
-- diverged from the gear library. Drop the column; the app reads weight via the
-- gear_items join, and weight edits in the list view write to gear_items.

alter table list_items drop column weight_grams;
