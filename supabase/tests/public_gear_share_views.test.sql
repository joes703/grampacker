-- supabase/tests/public_gear_share_views.test.sql
begin;
select plan(30);

create extension if not exists pgtap with schema extensions;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a1', 'share-owner@test.dev'),
  ('00000000-0000-0000-0000-0000000005a2', 'share-other@test.dev')
on conflict (id) do nothing;

insert into public.categories (id, user_id, name, sort_order) values
  ('51000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000005a1', 'Shelter', 0),
  ('51000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000005a1', 'Private', 1),
  ('51000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000005a2', 'Other', 0);

insert into public.gear_items (id, user_id, category_id, name, description, weight_grams, sort_order, status) values
  ('52000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000005a1', '51000000-0000-0000-0000-000000000001', 'Tent', null, 1200, 0, 'active'),
  ('52000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000005a1', '51000000-0000-0000-0000-000000000002', 'Private Bag', null, 500, 1, 'needs_repair'),
  ('52000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000005a2', '51000000-0000-0000-0000-000000000003', 'Other Tent', null, 1100, 0, 'active');

insert into public.lists (id, user_id, name, description, slug, is_shared, sort_order, group_worn, is_draft) values
  ('53000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000005a1', 'Shared Trip', 'shared', 'pubg01', true, 0, true, true),
  ('53000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000005a1', 'Private Trip', 'private', 'priv01', false, 1, false, true),
  ('53000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000005a2', 'Other Shared', 'other', 'othr01', true, 0, false, true);

insert into public.list_items (id, user_id, list_id, gear_item_id, quantity, is_worn, is_consumable, sort_order, is_packed, is_ready) values
  ('54000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000005a1', '53000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000001', 1, false, false, 0, true, true),
  ('54000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000005a1', '53000000-0000-0000-0000-000000000002', '52000000-0000-0000-0000-000000000002', 1, false, false, 0, true, true),
  ('54000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000005a2', '53000000-0000-0000-0000-000000000003', '52000000-0000-0000-0000-000000000003', 1, false, false, 0, false, false);

select is(
  (select array_agg(column_name::text order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'public_gear_lists'),
  array['id','slug','name','description','group_worn','is_draft']::text[],
  'public_gear_lists exposes only the public list columns');

select is(
  (select array_agg(column_name::text order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'public_gear_list_items'),
  array['id','list_id','gear_item_id','quantity','is_worn','is_consumable','sort_order','gear_name','gear_description','gear_weight_grams','gear_category_id']::text[],
  'public_gear_list_items exposes only flattened public list item + gear columns');

select is(
  (select array_agg(column_name::text order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'public_gear_categories'),
  array['id','name','sort_order']::text[],
  'public_gear_categories exposes only public category columns');

select is(
  (select count(*)::int
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('public_gear_lists','public_gear_list_items','public_gear_categories')
     and c.reloptions @> array['security_barrier=true','security_invoker=false']),
  3,
  'all public Gear share views are security-barrier, definer-rights views');

select is(
  (select count(*)::int
   from information_schema.columns
   where table_schema = 'public'
     and table_name in ('public_gear_lists','public_gear_list_items','public_gear_categories')
     and column_name in (
       'user_id','is_shared','ready_checks_enabled','is_packed','is_ready',
       'status','cost','purchase_date','created_at','updated_at',
       'gear_status','gear_cost','gear_purchase_date','gear_user_id','gear_created_at','gear_updated_at'
     )),
  0,
  'public Gear share views expose no private column names');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('categories','gear_items','lists','list_items')
     and grantee = 'anon'),
  0,
  'anon has no grants on the base Gear-list tables');

select bag_eq(
  $$ select table_name::text from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('public_gear_lists','public_gear_list_items','public_gear_categories')
       and grantee = 'anon'
       and privilege_type = 'SELECT' $$,
  $$ values ('public_gear_lists'), ('public_gear_list_items'), ('public_gear_categories') $$,
  'anon can SELECT the curated public Gear views');

select bag_eq(
  $$ select table_name::text, privilege_type::text from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('categories','gear_items','lists','list_items')
       and grantee = 'authenticated' $$,
  $$ values
       ('categories','SELECT'), ('categories','INSERT'), ('categories','UPDATE'), ('categories','DELETE'),
       ('gear_items','SELECT'), ('gear_items','INSERT'), ('gear_items','UPDATE'), ('gear_items','DELETE'),
       ('lists','SELECT'), ('lists','INSERT'), ('lists','UPDATE'), ('lists','DELETE'),
       ('list_items','SELECT'), ('list_items','INSERT'), ('list_items','UPDATE'), ('list_items','DELETE') $$,
  'authenticated keeps CRUD grants on the base Gear-list tables');

select bag_eq(
  $$ select table_name::text from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('public_gear_lists','public_gear_list_items','public_gear_categories')
       and grantee = 'authenticated'
       and privilege_type = 'SELECT' $$,
  $$ values ('public_gear_lists'), ('public_gear_list_items'), ('public_gear_categories') $$,
  'authenticated can SELECT the curated public Gear views');

select bag_eq(
  $$ select table_name::text, privilege_type::text from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('categories','gear_items','lists','list_items')
       and grantee = 'service_role' $$,
  $$ values
       ('categories','SELECT'), ('categories','INSERT'), ('categories','UPDATE'), ('categories','DELETE'),
       ('gear_items','SELECT'), ('gear_items','INSERT'), ('gear_items','UPDATE'), ('gear_items','DELETE'),
       ('lists','SELECT'), ('lists','INSERT'), ('lists','UPDATE'), ('lists','DELETE'),
       ('list_items','SELECT'), ('list_items','INSERT'), ('list_items','UPDATE'), ('list_items','DELETE') $$,
  'service_role keeps CRUD grants on the base Gear-list tables');

select bag_eq(
  $$ select table_name::text from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('public_gear_lists','public_gear_list_items','public_gear_categories')
       and grantee = 'service_role'
       and privilege_type = 'SELECT' $$,
  $$ values ('public_gear_lists'), ('public_gear_list_items'), ('public_gear_categories') $$,
  'service_role can SELECT the curated public Gear views');

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

select throws_ok($$ select count(*) from public.lists $$, '42501', NULL,
  'anon cannot read the base lists table');
select throws_ok($$ select count(*) from public.list_items $$, '42501', NULL,
  'anon cannot read the base list_items table');
select throws_ok($$ select count(*) from public.gear_items $$, '42501', NULL,
  'anon cannot read the base gear_items table');
select throws_ok($$ select count(*) from public.categories $$, '42501', NULL,
  'anon cannot read the base categories table');

select is((select count(*)::int from public.public_gear_lists), 2,
  'anon sees shared lists through the curated list view');
select is((select count(*)::int from public.public_gear_lists where slug = 'priv01'), 0,
  'anon does not see unshared lists through the curated list view');
select is((select count(*)::int from public.public_gear_list_items where list_id = '53000000-0000-0000-0000-000000000001'), 1,
  'anon sees items for a shared list through the curated item view');
select is((select count(*)::int from public.public_gear_list_items where list_id = '53000000-0000-0000-0000-000000000002'), 0,
  'anon does not see items for an unshared list through the curated item view');
select is((select gear_name from public.public_gear_list_items where id = '54000000-0000-0000-0000-000000000001'), 'Tent',
  'anon receives flattened public gear fields from the item view');
select is((select count(*)::int from public.public_gear_categories where id = '51000000-0000-0000-0000-000000000001'), 1,
  'anon sees categories referenced by shared list items');
select is((select count(*)::int from public.public_gear_categories where id = '51000000-0000-0000-0000-000000000002'), 0,
  'anon does not see categories referenced only by unshared list items');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000005a2","role":"authenticated"}';

select is((select count(*)::int from public.lists where id = '53000000-0000-0000-0000-000000000001'), 0,
  'authenticated non-owner cannot read another users shared list from the base table');
select is((select count(*)::int from public.list_items where id = '54000000-0000-0000-0000-000000000001'), 0,
  'authenticated non-owner cannot read another users shared list item from the base table');
select is((select count(*)::int from public.gear_items where id = '52000000-0000-0000-0000-000000000001'), 0,
  'authenticated non-owner cannot read another users shared gear item from the base table');
select is((select count(*)::int from public.categories where id = '51000000-0000-0000-0000-000000000001'), 0,
  'authenticated non-owner cannot read another users shared category from the base table');
select is((select count(*)::int from public.public_gear_lists where slug = 'pubg01'), 1,
  'authenticated non-owner can read another users shared list through the public view');
select is((select count(*)::int from public.lists where id = '53000000-0000-0000-0000-000000000003'), 1,
  'authenticated user still reads their own base list');

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000005a1","role":"authenticated"}';

select is((select count(*)::int from public.lists where id = '53000000-0000-0000-0000-000000000001'), 1,
  'owner still reads their own shared base list');
select is((select count(*)::int from public.public_gear_lists where slug = 'priv01'), 0,
  'owner does not see an unshared list through the public view');

select finish();
rollback;
