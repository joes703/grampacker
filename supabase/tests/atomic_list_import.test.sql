-- supabase/tests/atomic_list_import.test.sql
begin;
select plan(10);

create extension if not exists pgtap with schema extensions;

-- Fixture user + JWT impersonation so auth.uid() resolves under RLS.
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000001', 'importer@test.dev')
on conflict (id) do nothing;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ---- 5 success assertions -------------------------------------------------
select lives_ok($$
  select public.create_list_with_imported_items(
    '00000000-0000-0000-0000-000000000001', 'Imported', 'slug-success', 0,
    '[{"id":"10000000-0000-0000-0000-000000000001","name":"Shelter","sort_order":0}]'::jsonb,
    '[{"id":"20000000-0000-0000-0000-000000000001","name":"Tent","description":null,"weight_grams":1000,"category_id":"10000000-0000-0000-0000-000000000001","cost":null,"purchase_date":null,"status":"active","sort_order":0}]'::jsonb,
    '[{"gear_item_id":"20000000-0000-0000-0000-000000000001","quantity":1,"is_worn":false,"is_consumable":false,"sort_order":0}]'::jsonb
  )
$$, 'happy path commits');
select is((select count(*)::int from public.lists      where slug = 'slug-success'), 1, 'one list created');
select is((select count(*)::int from public.categories where id = '10000000-0000-0000-0000-000000000001'), 1, 'category created');
select is((select count(*)::int from public.gear_items where id = '20000000-0000-0000-0000-000000000001'), 1, 'gear created');
select is((select count(*)::int from public.list_items where gear_item_id = '20000000-0000-0000-0000-000000000001'), 1, 'list_item created');

-- ---- forced LATE failure + 4 per-table rollback assertions ----------------
create temporary table _counts as
  select (select count(*) from public.lists)      as l,
         (select count(*) from public.categories) as c,
         (select count(*) from public.gear_items) as g,
         (select count(*) from public.list_items) as li;

-- Plan passes reference validation but violates list_items_quantity_check
-- (quantity 0) at the FINAL insert, AFTER cats+gear+list -> whole txn rolls back.
select throws_ok($$
  select public.create_list_with_imported_items(
    '00000000-0000-0000-0000-000000000001', 'Bad', 'slug-rollback', 1,
    '[{"id":"10000000-0000-0000-0000-000000000002","name":"Cooking","sort_order":1}]'::jsonb,
    '[{"id":"20000000-0000-0000-0000-000000000002","name":"Stove","description":null,"weight_grams":200,"category_id":"10000000-0000-0000-0000-000000000002","cost":null,"purchase_date":null,"status":"active","sort_order":1}]'::jsonb,
    '[{"gear_item_id":"20000000-0000-0000-0000-000000000002","quantity":0,"is_worn":false,"is_consumable":false,"sort_order":0}]'::jsonb
  )
$$, 'late list_items failure raises');

select is((select count(*) from public.lists),      (select l  from _counts), 'lists unchanged after rollback');
select is((select count(*) from public.categories), (select c  from _counts), 'categories unchanged after rollback');
select is((select count(*) from public.gear_items), (select g  from _counts), 'gear_items unchanged after rollback');
select is((select count(*) from public.list_items), (select li from _counts), 'list_items unchanged after rollback');

select finish();
rollback;
