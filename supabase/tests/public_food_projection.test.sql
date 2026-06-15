-- supabase/tests/public_food_projection.test.sql
begin;
select plan(29);

create extension if not exists pgtap with schema extensions;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000006a1', 'food-share-owner@test.dev'),
  ('00000000-0000-0000-0000-0000000006a2', 'food-share-other@test.dev')
on conflict (id) do nothing;

insert into public.lists (id, user_id, name, description, slug, is_shared, sort_order, group_worn, is_draft) values
  ('63000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a1', 'Shared Food Trip', null, 'pubf01', true, 0, false, true),
  ('63000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000006a1', 'Private Food Trip', null, 'prvf01', false, 1, false, true),
  ('63000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000006a2', 'Other Food Trip', null, 'othf01', true, 0, false, true);

insert into public.food_items (
  id, user_id, name, brand, serving_description, serving_weight_grams, calories_per_serving,
  servings_per_package, notes, sort_order
) values
  ('61000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a1', 'Peanut butter', 'TrailCo', 'packet', 34, 190, null, 'private note', 0),
  ('61000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000006a1', 'Energy bar', null, 'bar', 50, 250, 2, 'private note', 1),
  ('61000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000006a1', 'Rice', null, '75 g', 75, 270, null, 'private note', 2),
  ('61000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000006a1', 'Private food', null, 'serving', 10, 10, null, 'private note', 3),
  ('61000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000006a2', 'Other food', null, 'serving', 20, 20, null, 'private note', 0);

insert into public.food_plans (id, user_id, list_id, is_food_shared) values
  ('62000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a1', '63000000-0000-0000-0000-000000000001', false),
  ('62000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000006a1', '63000000-0000-0000-0000-000000000002', true),
  ('62000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000006a2', '63000000-0000-0000-0000-000000000003', true);

insert into public.meals (id, user_id, food_plan_id, name, anchor_role, is_default, sort_order) values
  ('64000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a1', '62000000-0000-0000-0000-000000000001', 'On-trail food', null, true, 0),
  ('64000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000006a1', '62000000-0000-0000-0000-000000000002', 'On-trail food', null, true, 0),
  ('64000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000006a2', '62000000-0000-0000-0000-000000000003', 'On-trail food', null, true, 0);

insert into public.food_plan_days (id, user_id, food_plan_id, sort_order) values
  ('65000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a1', '62000000-0000-0000-0000-000000000001', 0),
  ('65000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000006a1', '62000000-0000-0000-0000-000000000002', 0),
  ('65000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000006a2', '62000000-0000-0000-0000-000000000003', 0);

insert into public.day_meals (id, user_id, food_plan_id, day_id, meal_id) values
  ('66000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a1', '62000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000001', '64000000-0000-0000-0000-000000000001'),
  ('66000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000006a1', '62000000-0000-0000-0000-000000000002', '65000000-0000-0000-0000-000000000002', '64000000-0000-0000-0000-000000000002'),
  ('66000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000006a2', '62000000-0000-0000-0000-000000000003', '65000000-0000-0000-0000-000000000003', '64000000-0000-0000-0000-000000000003');

insert into public.food_plan_entries (
  id, user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order
) values
  ('67000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a1', '62000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001', false, '61000000-0000-0000-0000-000000000001', 'servings', 1, 0),
  ('67000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000006a1', '62000000-0000-0000-0000-000000000001', null, true, '61000000-0000-0000-0000-000000000001', 'servings', 1, 10),
  ('67000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000006a1', '62000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001', false, '61000000-0000-0000-0000-000000000002', 'packages', 1, 1),
  ('67000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000006a1', '62000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001', false, '61000000-0000-0000-0000-000000000003', 'weight', 150, 2),
  ('67000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000006a1', '62000000-0000-0000-0000-000000000002', '66000000-0000-0000-0000-000000000002', false, '61000000-0000-0000-0000-000000000004', 'servings', 1, 0),
  ('67000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000006a2', '62000000-0000-0000-0000-000000000003', '66000000-0000-0000-0000-000000000003', false, '61000000-0000-0000-0000-000000000005', 'servings', 1, 0);

select is(
  (select array_agg(column_name::text order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'food_projection_public'),
  array['list_slug','food_name','brand','total_effective_servings','total_weight_grams']::text[],
  'food_projection_public exposes only aggregate food projection columns');

select is(
  (select count(*)::int
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'food_projection_public'
     and c.reloptions @> array['security_barrier=true','security_invoker=true']),
  1,
  'food_projection_public is a security-barrier, invoker-rights view');

select is(
  (select count(*)::int
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'food_projection_public'
     and column_name in (
       'id','user_id','list_id','food_plan_id','food_item_id','day_meal_id','is_extra',
       'notes','calories_per_serving','protein_grams','sodium_mg','is_food_shared',
       'created_at','updated_at','is_packed','packed_signature'
     )),
  0,
  'food_projection_public exposes no private or detailed Food plan columns');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('food_items','food_plans','food_plan_entries')
     and grantee = 'anon'),
  0,
  'anon has no table-level grants on Food base tables');

select ok(has_table_privilege('anon', 'public.food_projection_public', 'SELECT'),
  'anon can SELECT the aggregate food projection view');
select ok(has_table_privilege('service_role', 'public.food_projection_public', 'SELECT'),
  'service_role can SELECT the aggregate food projection view');
select ok(not has_table_privilege('authenticated', 'public.food_projection_public', 'SELECT'),
  'authenticated does not use the public projection view grant; browser public reads use the anon client');

select ok(has_column_privilege('anon', 'public.food_items', 'name', 'SELECT'),
  'anon has the food item name column grant needed by the invoker view');
select ok(has_column_privilege('anon', 'public.food_items', 'serving_weight_grams', 'SELECT'),
  'anon has the serving weight column grant needed by the invoker view');
select ok(not has_column_privilege('anon', 'public.food_items', 'notes', 'SELECT'),
  'anon cannot read food notes from the base table');
select ok(not has_column_privilege('anon', 'public.food_items', 'user_id', 'SELECT'),
  'anon cannot read food item owner ids from the base table');
select ok(not has_column_privilege('anon', 'public.food_plans', 'user_id', 'SELECT'),
  'anon cannot read food plan owner ids from the base table');
select ok(not has_column_privilege('anon', 'public.food_plan_entries', 'id', 'SELECT'),
  'anon cannot read food entry ids from the base table');

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

select throws_ok($$ select notes from public.food_items $$, '42501', NULL,
  'anon cannot read private food notes from the base food table');
select throws_ok($$ select calories_per_serving from public.food_items $$, '42501', NULL,
  'anon cannot read nutrition columns from the aggregate public surface');
select throws_ok($$ select id from public.food_plan_entries $$, '42501', NULL,
  'anon cannot read entry ids from the base food entries table');

select is((select count(*)::int from public.food_projection_public where list_slug = 'pubf01'), 3,
  'anon sees one aggregate food row per distinct food on a shared Gear list');
select is((select count(*)::int from public.food_projection_public where list_slug = 'prvf01'), 0,
  'anon does not see aggregate food rows for an unshared Gear list even when is_food_shared is true');
select is((select count(*)::int from public.food_projection_public where list_slug = 'othf01'), 1,
  'anon sees aggregate food rows for another shared Gear list');
select is((select total_effective_servings from public.food_projection_public where list_slug = 'pubf01' and food_name = 'Peanut butter'), 2::numeric,
  'servings-basis duplicate entries aggregate effective servings');
select is((select total_weight_grams from public.food_projection_public where list_slug = 'pubf01' and food_name = 'Peanut butter'), 68::numeric,
  'servings-basis duplicate entries aggregate total packed weight');
select is((select total_weight_grams from public.food_projection_public where list_slug = 'pubf01' and food_name = 'Energy bar'), 100::numeric,
  'packages-basis entries use servings_per_package for aggregate weight');
select is((select total_effective_servings from public.food_projection_public where list_slug = 'pubf01' and food_name = 'Rice'), 2::numeric,
  'weight-basis entries derive effective servings for display');

select is((select count(name)::int from public.food_items where name = 'Peanut butter'), 1,
  'anon can reach public food columns only for foods used by shared lists');
select is((select count(name)::int from public.food_items where name = 'Private food'), 0,
  'anon cannot reach food rows used only by unshared lists');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000006a2","role":"authenticated"}';

select is((select count(*)::int from public.food_items where id = '61000000-0000-0000-0000-000000000001'), 0,
  'authenticated non-owner cannot read another users food item from the base table');
select is((select count(*)::int from public.food_plan_entries where id = '67000000-0000-0000-0000-000000000001'), 0,
  'authenticated non-owner cannot read another users food entries from the base table');
select throws_ok($$ select count(*) from public.food_projection_public where list_slug = 'pubf01' $$, '42501', NULL,
  'authenticated non-owner does not use the public projection view grant; browser public reads use the anon client');

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000006a1","role":"authenticated"}';

select is((select count(*)::int from public.food_items where id = '61000000-0000-0000-0000-000000000004'), 1,
  'owner still reads their own unshared food item from the base table');

select finish();
rollback;
