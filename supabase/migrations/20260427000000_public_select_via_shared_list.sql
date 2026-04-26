-- Public read access for gear_items and categories that are referenced by a shared list,
-- so the /r/:token public share page can render real item names, descriptions, and category groupings.

create policy "gear_items_public_select_via_shared_list" on gear_items
  for select using (
    exists (
      select 1
      from list_items li
      join lists l on l.id = li.list_id
      where li.gear_item_id = gear_items.id and l.is_shared = true
    )
  );

create policy "categories_public_select_via_shared_list" on categories
  for select using (
    exists (
      select 1
      from gear_items g
      join list_items li on li.gear_item_id = g.id
      join lists l on l.id = li.list_id
      where g.category_id = categories.id and l.is_shared = true
    )
  );
