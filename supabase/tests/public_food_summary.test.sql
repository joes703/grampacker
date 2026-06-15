-- supabase/tests/public_food_summary.test.sql
--
-- Public Gear shares show total carried food WEIGHT only, never the menu.
-- food_projection_public_summary(slug) returns a single aggregate number,
-- SECURITY DEFINER + search_path='' (bypasses RLS, self-gates on is_shared).
-- anon has zero direct access to the food base tables; itemized food stays
-- behind get_public_food_plan, dual-gated on is_shared AND is_food_shared.
begin;
select plan(21);

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

-- Expected pubf01 total weight:
--   Peanut butter servings 1 -> 1*34 = 34
--   Peanut butter extra servings 1 -> 34
--   Energy bar packages 1 -> 1*2*50 = 100
--   Rice weight 150 -> 150
--   total = 318
-- othf01: Other food servings 1 -> 1*20 = 20

-- 1. The itemized view is gone.
select is(
  (select count(*)::int from information_schema.views
   where table_schema = 'public' and table_name = 'food_projection_public'),
  0, 'itemized food_projection_public view is dropped');

-- 2-3. Summary function exists, is SECURITY DEFINER with a pinned search_path.
select is(
  (select prosecdef from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='food_projection_public_summary'),
  true, 'food_projection_public_summary is SECURITY DEFINER');
select ok(
  exists (select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='food_projection_public_summary'
      and p.proconfig @> array['search_path=']),
  'food_projection_public_summary pins search_path to empty');

-- 4-6. Grant matrix: anon + service_role execute; authenticated + public do not.
select ok(has_function_privilege('anon', 'public.food_projection_public_summary(text)', 'execute'),
  'anon can execute the summary function');
select ok(has_function_privilege('service_role', 'public.food_projection_public_summary(text)', 'execute'),
  'service_role can execute the summary function');
select ok(not has_function_privilege('authenticated', 'public.food_projection_public_summary(text)', 'execute'),
  'authenticated does not use the summary grant; browser public reads use the anon client');

-- 7. anon has NO explicit grant on the food base tables anymore.
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema='public'
     and table_name in ('food_items','food_plans','food_plan_entries')
     and grantee='anon'), 0,
  'anon has no explicit table-level grants on Food base tables');

-- 8-9. EFFECTIVE-privilege sweeps: prove anon cannot SELECT regardless of HOW
-- the privilege might arrive (explicit grant to anon, a grant to PUBLIC, or any
-- inherited role path). An explicit-grant sweep alone would miss those.
select is(
  (select count(*)::int
   from (values ('food_items'),('food_plans'),('food_plan_entries')) t(tbl)
   where has_table_privilege('anon', format('public.%I', tbl), 'SELECT')),
  0,
  'anon has no effective SELECT privilege on any Food base table');
select is(
  (select count(*)::int
   from information_schema.columns
   where table_schema = 'public'
     and table_name in ('food_items','food_plans','food_plan_entries')
     and has_column_privilege(
       'anon',
       format('%I.%I', table_schema, table_name),
       column_name,
       'SELECT'
     )),
  0,
  'anon has no effective SELECT privilege on any Food base-table column');

-- 10-12. Named regression checks for the columns the superseded view leaked.
select ok(not has_column_privilege('anon', 'public.food_items', 'name', 'SELECT'),
  'anon cannot read food item names from the base table');
select ok(not has_column_privilege('anon', 'public.food_items', 'serving_weight_grams', 'SELECT'),
  'anon cannot read serving weights from the base table');
select ok(not has_column_privilege('anon', 'public.food_plan_entries', 'food_item_id', 'SELECT'),
  'anon cannot read food entry item ids from the base table');

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

-- 13-15. anon is fully blocked from the food base tables.
select throws_ok($$ select name from public.food_items $$, '42501', NULL,
  'anon cannot read food item names directly');
select throws_ok($$ select food_item_id from public.food_plan_entries $$, '42501', NULL,
  'anon cannot read food entry item ids directly');
select throws_ok($$ select id from public.food_plans $$, '42501', NULL,
  'anon cannot read food plan rows directly');

-- 16-20. Summary: aggregate weight only, gated on is_shared, independent of is_food_shared.
select is(public.food_projection_public_summary('pubf01'), 318::numeric,
  'summary returns total carried food weight for a shared Gear list');
select is(public.food_projection_public_summary('pubf01'), 318::numeric,
  'summary ignores is_food_shared=false (weight still shown on Gear share)');
select is(public.food_projection_public_summary('othf01'), 20::numeric,
  'summary returns weight for another shared Gear list');
select is(public.food_projection_public_summary('prvf01'), 0::numeric,
  'summary returns 0 for an unshared Gear list even when is_food_shared is true');
select is(public.food_projection_public_summary('nope-no-list'), 0::numeric,
  'summary returns 0 for an unknown slug');

-- 21. The detailed menu stays dual-gated: pubf01 has is_food_shared=false, so
-- the detail RPC yields nothing even though the weight summary is non-zero.
select ok(public.get_public_food_plan('pubf01') is null,
  'detailed food plan stays hidden when is_food_shared is false (dual-gate intact)');

select finish();
rollback;
