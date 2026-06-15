-- supabase/tests/public_food_plan_detail.test.sql
begin;
select plan(25);

create extension if not exists pgtap with schema extensions;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007a1', 'public-food-plan-owner@test.dev'),
  ('00000000-0000-0000-0000-0000000007a2', 'public-food-plan-other@test.dev')
on conflict (id) do nothing;

insert into public.lists (id, user_id, name, description, slug, is_shared, sort_order, group_worn, is_draft) values
  ('73000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a1', 'Detailed Food Trip', null, 'pubd01', true, 0, false, true),
  ('73000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000007a1', 'Aggregate Only Trip', null, 'aggd01', true, 1, false, true),
  ('73000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000007a1', 'Private Food Trip', null, 'prvd01', false, 2, false, true);

insert into public.food_items (
  id, user_id, name, brand, serving_description, serving_weight_grams, calories_per_serving,
  servings_per_package, fat_grams, carbs_grams, protein_grams, sodium_mg, notes, sort_order
) values
  ('71000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a1', 'Energy bar', 'TrailCo', 'bar', 50, 250, 2, 8, 35, 12, 180, 'private note', 0),
  ('71000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000007a1', 'Oatmeal', null, 'packet', 40, 160, null, 3, 27, 5, 120, 'private note', 1),
  ('71000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000007a1', 'Aggregate food', null, 'serving', 25, 100, null, null, null, null, null, 'private note', 2),
  ('71000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000007a1', 'Private food', null, 'serving', 25, 100, null, null, null, null, null, 'private note', 3);

insert into public.food_plans (id, user_id, list_id, is_food_shared) values
  ('72000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a1', '73000000-0000-0000-0000-000000000001', true),
  ('72000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000007a1', '73000000-0000-0000-0000-000000000002', false),
  ('72000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000007a1', '73000000-0000-0000-0000-000000000003', true);

insert into public.meals (id, user_id, food_plan_id, name, anchor_role, is_default, sort_order) values
  ('74000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000001', 'Breakfast', 'breakfast', true, 0),
  ('74000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000001', 'On-trail food', null, true, 1),
  ('74000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000002', 'On-trail food', null, true, 0),
  ('74000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000003', 'On-trail food', null, true, 0);

insert into public.food_plan_days (id, user_id, food_plan_id, day_type_override, sort_order) values
  ('75000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000001', null, 0),
  ('75000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000001', 'partial', 1),
  ('75000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000002', null, 0),
  ('75000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000003', null, 0);

insert into public.day_meals (id, user_id, food_plan_id, day_id, meal_id) values
  ('76000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000001'),
  ('76000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000002'),
  ('76000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000002', '75000000-0000-0000-0000-000000000003', '74000000-0000-0000-0000-000000000003'),
  ('76000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000003', '75000000-0000-0000-0000-000000000004', '74000000-0000-0000-0000-000000000004');

insert into public.food_plan_entries (
  id, user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order
) values
  ('77000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000001', '76000000-0000-0000-0000-000000000001', false, '71000000-0000-0000-0000-000000000002', 'servings', 1, 0),
  ('77000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000001', '76000000-0000-0000-0000-000000000002', false, '71000000-0000-0000-0000-000000000001', 'packages', 1, 1),
  ('77000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000001', null, true, '71000000-0000-0000-0000-000000000001', 'weight', 75, 2),
  ('77000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000002', '76000000-0000-0000-0000-000000000003', false, '71000000-0000-0000-0000-000000000003', 'servings', 1, 0),
  ('77000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000003', '76000000-0000-0000-0000-000000000004', false, '71000000-0000-0000-0000-000000000004', 'servings', 1, 0);

insert into public.food_plan_daily_targets (id, user_id, food_plan_id, metric, mode, target_min, target_max) values
  ('78000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000001', 'calories', 'range', 2000, 3000);
insert into public.meal_targets (id, user_id, food_plan_id, meal_id, metric, mode, target_min, target_max) values
  ('79000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a1', '72000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000002', 'protein', 'min', 20, null);

select is(
  (select prosecdef from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_public_food_plan'),
  true,
  'get_public_food_plan is a deliberate security-definer RPC');
select ok(has_function_privilege('anon', 'public.get_public_food_plan(text)', 'EXECUTE'),
  'anon can execute get_public_food_plan');
select ok(has_function_privilege('service_role', 'public.get_public_food_plan(text)', 'EXECUTE'),
  'service_role can execute get_public_food_plan');
select ok(not has_function_privilege('authenticated', 'public.get_public_food_plan(text)', 'EXECUTE'),
  'authenticated does not use the public detail RPC grant; browser public reads use the anon client');

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

select throws_ok($$ select id from public.food_plan_entries $$, '42501', NULL,
  'anon still cannot directly read food entry ids from the base table');
select throws_ok($$ select notes from public.food_items $$, '42501', NULL,
  'anon still cannot directly read food notes from the base table');

select isnt(public.get_public_food_plan('pubd01'), null::jsonb,
  'anon receives a detailed Food plan when list and food-plan sharing are both enabled');
select is(public.get_public_food_plan('pubd01')->'plan'->>'list_slug', 'pubd01',
  'document carries the public list slug');
select is(public.get_public_food_plan('aggd01'), null::jsonb,
  'anon receives no detailed Food plan when only aggregate Gear sharing is enabled');
select is(public.get_public_food_plan('prvd01'), null::jsonb,
  'anon receives no detailed Food plan when the parent Gear list is private');
select is(public.get_public_food_plan('nope00'), null::jsonb,
  'anon receives null for an unknown slug');

select is(
  (select array_agg(key order by key) from jsonb_object_keys(public.get_public_food_plan('pubd01')) key),
  array['dailyTargets','dayMeals','days','entries','foods','meals','mealTargets','plan']::text[],
  'document exposes only the expected top-level keys');
select ok(not jsonb_path_exists(public.get_public_food_plan('pubd01'), '$.**.user_id'),
  'document exposes no owner ids');
select ok(not jsonb_path_exists(public.get_public_food_plan('pubd01'), '$.**.notes'),
  'document exposes no food notes');
select ok(not jsonb_path_exists(public.get_public_food_plan('pubd01'), '$.**.created_at'),
  'document exposes no timestamps');
select ok(not jsonb_path_exists(public.get_public_food_plan('pubd01'), '$.**.is_packed'),
  'document exposes no food pack state');

select is(jsonb_array_length(public.get_public_food_plan('pubd01')->'meals'), 2,
  'document includes meal definitions');
select is(jsonb_array_length(public.get_public_food_plan('pubd01')->'days'), 2,
  'document includes days');
select is(jsonb_array_length(public.get_public_food_plan('pubd01')->'dayMeals'), 2,
  'document includes the schedule grid');
select is(jsonb_array_length(public.get_public_food_plan('pubd01')->'entries'), 3,
  'document includes entries');
select is(jsonb_array_length(public.get_public_food_plan('pubd01')->'foods'), 2,
  'document includes only foods used by the shared plan');
select is(jsonb_array_length(public.get_public_food_plan('pubd01')->'dailyTargets'), 1,
  'document includes daily targets');
select is(jsonb_array_length(public.get_public_food_plan('pubd01')->'mealTargets'), 1,
  'document includes meal targets');
select is((public.get_public_food_plan('pubd01')->'foods'->0->>'calories_per_serving')::numeric, 250::numeric,
  'document includes nutrition needed for public totals');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000007a2","role":"authenticated"}';
select throws_ok($$ select public.get_public_food_plan('pubd01') $$, '42501', NULL,
  'authenticated callers do not use the public detail RPC grant; browser public reads use the anon client');

select finish();
rollback;
