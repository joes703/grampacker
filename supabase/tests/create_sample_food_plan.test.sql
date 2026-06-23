-- supabase/tests/create_sample_food_plan.test.sql
begin;
select plan(28);

create extension if not exists pgtap with schema extensions;

-- Grant matrix (no-anon contract). Do NOT invoke the revoked function as anon:
-- local Postgres 17.6.1.105 has been observed to terminate the server on that
-- path; the privilege check is the authoritative assertion.
select ok(has_function_privilege('authenticated', 'public.create_sample_food_plan(uuid,uuid,jsonb)', 'execute'),
  'authenticated can execute create_sample_food_plan');
select ok(not has_function_privilege('anon', 'public.create_sample_food_plan(uuid,uuid,jsonb)', 'execute'),
  'anon cannot execute create_sample_food_plan');

insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-0000000000a1', 'sample-plan-owner@test.dev'),
  ('b0000000-0000-0000-0000-0000000000a2', 'sample-plan-other@test.dev')
on conflict (id) do nothing;

insert into public.lists (id, user_id, name, slug, sort_order, group_worn, is_draft) values
  ('b3000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000a1', 'Target trip',   'smp001', 0, false, true),
  ('b3000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000a1', 'Atomic trip',   'smp002', 1, false, true),
  ('b3000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-0000000000a1', 'Occupied trip', 'smp003', 2, false, true),
  ('b3000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-0000000000a2', 'Other trip',    'smp004', 0, false, true);

-- Existing owned library food: the payload references it WITHOUT re-creating it
-- (the reuse-by-name+brand path, resolved client-side).
insert into public.food_items (
  id, user_id, name, brand, serving_description, serving_weight_grams, calories_per_serving, servings_per_package, sort_order
) values
  ('b1000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-0000000000a1', 'Instant coffee', 'Starbucks Via', '1 stick', 2.3, 5, 1, 0);

-- A pre-existing plan on the "Occupied" list, for the already-has-a-plan reject.
insert into public.food_plans (id, user_id, list_id, is_food_shared) values
  ('b2000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-0000000000a1', 'b3000000-0000-0000-0000-000000000003', false);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

create temporary table sample_plan_result on commit drop as
select * from public.create_sample_food_plan(
  'b0000000-0000-0000-0000-0000000000a1',
  'b3000000-0000-0000-0000-000000000001',
  '{
    "foods": [
      {"id":"b1000000-0000-0000-0000-000000000001","name":"Olive oil","brand":null,"serving_description":"1 tbsp","serving_weight_grams":14,"calories_per_serving":120,"servings_per_package":null,"fat_grams":14,"saturated_fat_grams":2,"carbs_grams":0,"fiber_grams":0,"sugar_grams":0,"protein_grams":0,"sodium_mg":0,"potassium_mg":0,"notes":"Calorie-dense dinner add.","sort_order":10},
      {"id":"b1000000-0000-0000-0000-000000000002","name":"Fruit leather","brand":"Homemade","serving_description":"1 strip","serving_weight_grams":15,"calories_per_serving":45,"servings_per_package":null,"fat_grams":null,"saturated_fat_grams":null,"carbs_grams":11,"fiber_grams":null,"sugar_grams":9,"protein_grams":null,"sodium_mg":null,"potassium_mg":null,"notes":null,"sort_order":11},
      {"id":"b1000000-0000-0000-0000-000000000003","name":"Beef stroganoff","brand":"Mountain House","serving_description":"1 cup","serving_weight_grams":70,"calories_per_serving":250,"servings_per_package":2,"fat_grams":9,"saturated_fat_grams":4,"carbs_grams":32,"fiber_grams":2,"sugar_grams":4,"protein_grams":11,"sodium_mg":720,"potassium_mg":300,"notes":null,"sort_order":12}
    ],
    "meals": [
      {"id":"b4000000-0000-0000-0000-000000000001","name":"Breakfast","anchor_role":"breakfast","is_default":true,"sort_order":0},
      {"id":"b4000000-0000-0000-0000-000000000002","name":"Dinner","anchor_role":"dinner","is_default":true,"sort_order":1}
    ],
    "days": [
      {"id":"b5000000-0000-0000-0000-000000000001","day_type_override":null,"sort_order":0},
      {"id":"b5000000-0000-0000-0000-000000000002","day_type_override":null,"sort_order":1}
    ],
    "day_meals": [
      {"id":"b6000000-0000-0000-0000-000000000001","day_id":"b5000000-0000-0000-0000-000000000001","meal_id":"b4000000-0000-0000-0000-000000000001"},
      {"id":"b6000000-0000-0000-0000-000000000002","day_id":"b5000000-0000-0000-0000-000000000001","meal_id":"b4000000-0000-0000-0000-000000000002"},
      {"id":"b6000000-0000-0000-0000-000000000003","day_id":"b5000000-0000-0000-0000-000000000002","meal_id":"b4000000-0000-0000-0000-000000000001"}
    ],
    "entries": [
      {"id":"b7000000-0000-0000-0000-000000000001","day_meal_id":"b6000000-0000-0000-0000-000000000001","is_extra":false,"food_item_id":"b1000000-0000-0000-0000-0000000000e1","basis":"servings","amount":1,"sort_order":0},
      {"id":"b7000000-0000-0000-0000-000000000002","day_meal_id":"b6000000-0000-0000-0000-000000000002","is_extra":false,"food_item_id":"b1000000-0000-0000-0000-000000000003","basis":"packages","amount":1,"sort_order":0},
      {"id":"b7000000-0000-0000-0000-000000000003","day_meal_id":"b6000000-0000-0000-0000-000000000002","is_extra":false,"food_item_id":"b1000000-0000-0000-0000-000000000001","basis":"weight","amount":14,"sort_order":1},
      {"id":"b7000000-0000-0000-0000-000000000004","day_meal_id":null,"is_extra":true,"food_item_id":"b1000000-0000-0000-0000-000000000002","basis":"servings","amount":2,"sort_order":0}
    ],
    "daily_targets": [
      {"id":"b8000000-0000-0000-0000-000000000001","metric":"calories","mode":"range","target_min":2000,"target_max":3000}
    ],
    "meal_targets": [
      {"id":"b9000000-0000-0000-0000-000000000001","meal_id":"b4000000-0000-0000-0000-000000000002","metric":"protein","mode":"min","target_min":28,"target_max":null}
    ]
  }'::jsonb
);

-- Owner can create the sample plan.
select is((select count(*)::int from sample_plan_result), 1, 'returns one new food plan');
select is((select is_food_shared from sample_plan_result), false, 'sample plan starts private (never shared)');
select is((select list_id from sample_plan_result), 'b3000000-0000-0000-0000-000000000001'::uuid, 'targets the requested list');

-- Whole graph created.
select is((select count(*)::int from public.meals where food_plan_id = (select id from sample_plan_result)), 2, 'creates meals');
select is((select count(*)::int from public.food_plan_days where food_plan_id = (select id from sample_plan_result)), 2, 'creates days');
select is((select count(*)::int from public.day_meals where food_plan_id = (select id from sample_plan_result)), 3, 'creates the schedule grid');
select is((select count(*)::int from public.food_plan_entries where food_plan_id = (select id from sample_plan_result)), 4, 'creates entries');
select is((select count(*)::int from public.food_plan_daily_targets where food_plan_id = (select id from sample_plan_result)), 1, 'creates daily targets');
select is((select count(*)::int from public.meal_targets where food_plan_id = (select id from sample_plan_result)), 1, 'creates meal targets');

-- Basis examples: servings (reusing the existing coffee), packages, weight/grams.
select is(
  (select count(*)::int from public.food_plan_entries
   where food_plan_id = (select id from sample_plan_result)
     and basis = 'servings' and amount = 1 and food_item_id = 'b1000000-0000-0000-0000-0000000000e1'),
  1, 'creates a servings entry that reuses the existing food');
select is(
  (select count(*)::int from public.food_plan_entries
   where food_plan_id = (select id from sample_plan_result) and basis = 'packages' and amount = 1),
  1, 'creates a packages-basis entry');
select is(
  (select count(*)::int from public.food_plan_entries
   where food_plan_id = (select id from sample_plan_result) and basis = 'weight' and amount = 14),
  1, 'creates a weight/grams-basis entry');

-- Extras: is_extra with no day_meal.
select is(
  (select count(*)::int from public.food_plan_entries
   where food_plan_id = (select id from sample_plan_result) and is_extra and day_meal_id is null),
  1, 'creates an Extras entry');

-- Nutrition fidelity: unknown stays null, measured zero stays zero.
select is((select fat_grams from public.food_items where id = 'b1000000-0000-0000-0000-000000000002'),
  null, 'unknown nutrient stays null (Fruit leather fat)');
select is((select sodium_mg from public.food_items where id = 'b1000000-0000-0000-0000-000000000001'),
  0::numeric, 'measured zero stays zero (Olive oil sodium)');

-- Foods: 3 new inserted, the existing coffee reused (not duplicated) = 4 total.
select is((select count(*)::int from public.food_items where user_id = 'b0000000-0000-0000-0000-0000000000a1'),
  4, 'inserts only the new foods and reuses the existing one');

-- Never writes pack state; never touches gear/list items.
select is((select count(*)::int from public.food_pack_state where food_plan_id = (select id from sample_plan_result)),
  0, 'does not create pack state');
select is((select count(*)::int from public.gear_items where user_id = 'b0000000-0000-0000-0000-0000000000a1'),
  0, 'does not create gear items');
select is((select count(*)::int from public.list_items where user_id = 'b0000000-0000-0000-0000-0000000000a1'),
  0, 'does not create list items');

-- Rejects a list that already has a plan (the pre-seeded "Occupied" list).
select throws_ok($$
  select public.create_sample_food_plan(
    'b0000000-0000-0000-0000-0000000000a1',
    'b3000000-0000-0000-0000-000000000003',
    '{"foods":[],"meals":[],"days":[],"day_meals":[],"entries":[],"daily_targets":[],"meal_targets":[]}'::jsonb
  )
$$, '22023', NULL, 'rejects a list that already has a food plan');

-- Rejects a list owned by another user.
select throws_ok($$
  select public.create_sample_food_plan(
    'b0000000-0000-0000-0000-0000000000a1',
    'b3000000-0000-0000-0000-000000000004',
    '{"foods":[],"meals":[],"days":[],"day_meals":[],"entries":[],"daily_targets":[],"meal_targets":[]}'::jsonb
  )
$$, 'P0002', NULL, 'rejects a list owned by another user');

-- Rejects a mismatched p_user_id (not the authenticated user).
select throws_ok($$
  select public.create_sample_food_plan(
    'b0000000-0000-0000-0000-0000000000a2',
    'b3000000-0000-0000-0000-000000000002',
    '{"foods":[],"meals":[],"days":[],"day_meals":[],"entries":[],"daily_targets":[],"meal_targets":[]}'::jsonb
  )
$$, '42501', NULL, 'rejects a mismatched p_user_id');

-- Rejects an entry referencing a food the caller does not own and did not mint.
select throws_ok($$
  select public.create_sample_food_plan(
    'b0000000-0000-0000-0000-0000000000a1',
    'b3000000-0000-0000-0000-000000000002',
    '{"foods":[],"meals":[],"days":[],"day_meals":[],
      "entries":[{"id":"b7000000-0000-0000-0000-0000000000ff","day_meal_id":null,"is_extra":true,"food_item_id":"b1000000-0000-0000-0000-0000000000ff","basis":"servings","amount":1,"sort_order":0}],
      "daily_targets":[],"meal_targets":[]}'::jsonb
  )
$$, 'P0002', NULL, 'rejects an entry referencing an unknown food item');

-- Atomicity: a mid-insert failure (meal target -> non-existent meal) rolls the
-- whole plan back, leaving no plan and no orphaned food rows on that list.
select throws_ok($$
  select public.create_sample_food_plan(
    'b0000000-0000-0000-0000-0000000000a1',
    'b3000000-0000-0000-0000-000000000002',
    '{"foods":[{"id":"b100000a-0000-0000-0000-00000000000a","name":"Scratch food","brand":null,"serving_description":"1","serving_weight_grams":10,"calories_per_serving":10,"servings_per_package":null,"fat_grams":null,"saturated_fat_grams":null,"carbs_grams":null,"fiber_grams":null,"sugar_grams":null,"protein_grams":null,"sodium_mg":null,"potassium_mg":null,"notes":null,"sort_order":0}],
      "meals":[{"id":"b400000a-0000-0000-0000-00000000000a","name":"Breakfast","anchor_role":null,"is_default":true,"sort_order":0}],
      "days":[{"id":"b500000a-0000-0000-0000-00000000000a","day_type_override":null,"sort_order":0}],
      "day_meals":[{"id":"b600000a-0000-0000-0000-00000000000a","day_id":"b500000a-0000-0000-0000-00000000000a","meal_id":"b400000a-0000-0000-0000-00000000000a"}],
      "entries":[{"id":"b700000a-0000-0000-0000-00000000000a","day_meal_id":"b600000a-0000-0000-0000-00000000000a","is_extra":false,"food_item_id":"b100000a-0000-0000-0000-00000000000a","basis":"servings","amount":1,"sort_order":0}],
      "daily_targets":[],
      "meal_targets":[{"id":"b900000a-0000-0000-0000-00000000000a","meal_id":"b400000a-0000-0000-0000-0000000000ff","metric":"protein","mode":"min","target_min":1,"target_max":null}]}'::jsonb
  )
$$, '23503', NULL, 'a mid-insert failure raises and aborts');
select is((select count(*)::int from public.food_plans where list_id = 'b3000000-0000-0000-0000-000000000002'),
  0, 'rollback leaves no food plan on the list');
select is((select count(*)::int from public.food_items where id = 'b100000a-0000-0000-0000-00000000000a'),
  0, 'rollback leaves no orphaned food item');

select finish();
rollback;
