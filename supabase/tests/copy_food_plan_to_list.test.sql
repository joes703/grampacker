-- supabase/tests/copy_food_plan_to_list.test.sql
begin;
select plan(28);

create extension if not exists pgtap with schema extensions;

select ok(has_function_privilege('authenticated', 'public.copy_food_plan_to_list(uuid,uuid,uuid)', 'execute'),
  'authenticated can execute copy_food_plan_to_list');
select ok(has_function_privilege('service_role', 'public.copy_food_plan_to_list(uuid,uuid,uuid)', 'execute'),
  'service_role can execute copy_food_plan_to_list');
select ok(not has_function_privilege('anon', 'public.copy_food_plan_to_list(uuid,uuid,uuid)', 'execute'),
  'anon cannot execute copy_food_plan_to_list');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000008a1', 'copy-food-plan-owner@test.dev'),
  ('00000000-0000-0000-0000-0000000008a2', 'copy-food-plan-other@test.dev')
on conflict (id) do nothing;

insert into public.lists (id, user_id, name, slug, sort_order, group_worn, is_draft) values
  ('83000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a1', 'Source trip', 'cpy001', 0, false, true),
  ('83000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000008a1', 'Target trip', 'cpy002', 1, false, true),
  ('83000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000008a1', 'Occupied trip', 'cpy003', 2, false, true),
  ('83000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000008a2', 'Other trip', 'cpy004', 0, false, true);

insert into public.food_items (
  id, user_id, name, serving_description, serving_weight_grams, calories_per_serving, servings_per_package, sort_order
) values
  ('81000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a1', 'Energy bar', 'bar', 50, 250, 2, 0),
  ('81000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000008a1', 'Oatmeal', 'packet', 40, 160, null, 1);

insert into public.food_plans (id, user_id, list_id, is_food_shared) values
  ('82000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a1', '83000000-0000-0000-0000-000000000001', true),
  ('82000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000008a1', '83000000-0000-0000-0000-000000000003', false);

insert into public.meals (id, user_id, food_plan_id, name, anchor_role, is_default, sort_order) values
  ('84000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a1', '82000000-0000-0000-0000-000000000001', 'Breakfast', 'breakfast', true, 0),
  ('84000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000008a1', '82000000-0000-0000-0000-000000000001', 'Dinner', 'dinner', true, 1);

insert into public.food_plan_days (id, user_id, food_plan_id, day_type_override, sort_order) values
  ('85000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a1', '82000000-0000-0000-0000-000000000001', null, 0),
  ('85000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000008a1', '82000000-0000-0000-0000-000000000001', 'partial', 1);

insert into public.day_meals (id, user_id, food_plan_id, day_id, meal_id) values
  ('86000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a1', '82000000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001'),
  ('86000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000008a1', '82000000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000002');

insert into public.food_plan_entries (
  id, user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order
) values
  ('87000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a1', '82000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000001', false, '81000000-0000-0000-0000-000000000002', 'servings', 1, 0),
  ('87000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000008a1', '82000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000002', false, '81000000-0000-0000-0000-000000000001', 'packages', 1, 1),
  ('87000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000008a1', '82000000-0000-0000-0000-000000000001', null, true, '81000000-0000-0000-0000-000000000001', 'weight', 75, 2);

insert into public.food_plan_daily_targets (id, user_id, food_plan_id, metric, mode, target_min, target_max) values
  ('88000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a1', '82000000-0000-0000-0000-000000000001', 'calories', 'range', 2000, 3000);
insert into public.meal_targets (id, user_id, food_plan_id, meal_id, metric, mode, target_min, target_max) values
  ('89000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a1', '82000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000002', 'protein', 'min', 20, null);

insert into public.food_pack_state (id, user_id, food_plan_id, food_item_id, is_packed, packed_signature) values
  ('8a000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a1', '82000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', true, '100|50');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000008a1","role":"authenticated"}';

create temporary table copied_food_plan_result on commit drop as
select *
from public.copy_food_plan_to_list(
  '00000000-0000-0000-0000-0000000008a1',
  '82000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000002'
);

select is((select count(*)::int from copied_food_plan_result), 1, 'copy returns one new food plan');
select isnt((select id from copied_food_plan_result), '82000000-0000-0000-0000-000000000001'::uuid, 'copy mints a new food plan id');
select is((select list_id from copied_food_plan_result), '83000000-0000-0000-0000-000000000002'::uuid, 'copy targets the requested list');
select is((select is_food_shared from copied_food_plan_result), false, 'copy starts private even when source is shared');

select is((select count(*)::int from public.meals where food_plan_id = (select id from copied_food_plan_result)), 2, 'copy duplicates meal definitions');
select is((select count(*)::int from public.food_plan_days where food_plan_id = (select id from copied_food_plan_result)), 2, 'copy duplicates days');
select is((select count(*)::int from public.day_meals where food_plan_id = (select id from copied_food_plan_result)), 2, 'copy duplicates the schedule grid');
select is((select count(*)::int from public.food_plan_entries where food_plan_id = (select id from copied_food_plan_result)), 3, 'copy duplicates entries');
select is((select count(*)::int from public.food_plan_daily_targets where food_plan_id = (select id from copied_food_plan_result)), 1, 'copy duplicates daily targets');
select is((select count(*)::int from public.meal_targets where food_plan_id = (select id from copied_food_plan_result)), 1, 'copy duplicates meal targets');

select is(
  (select count(*)::int from public.meals where food_plan_id = (select id from copied_food_plan_result) and id in ('84000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000002')),
  0,
  'copied meals do not reuse source ids');
select is(
  (select count(*)::int from public.food_plan_days where food_plan_id = (select id from copied_food_plan_result) and id in ('85000000-0000-0000-0000-000000000001','85000000-0000-0000-0000-000000000002')),
  0,
  'copied days do not reuse source ids');
select is(
  (select count(*)::int from public.food_plan_entries where food_plan_id = (select id from copied_food_plan_result) and id in ('87000000-0000-0000-0000-000000000001','87000000-0000-0000-0000-000000000002','87000000-0000-0000-0000-000000000003')),
  0,
  'copied entries do not reuse source ids');

select is(
  (select count(*)::int
   from public.food_plan_entries e
   where e.food_plan_id = (select id from copied_food_plan_result)
     and e.is_extra
     and e.day_meal_id is null
     and e.basis = 'weight'
     and e.amount = 75),
  1,
  'copy preserves Extras entries');
select is(
  (select count(*)::int
   from public.food_plan_entries e
   join public.day_meals dm on dm.id = e.day_meal_id
   join public.meals m on m.id = dm.meal_id
   where e.food_plan_id = (select id from copied_food_plan_result)
     and m.name = 'Dinner'
     and e.basis = 'packages'
     and e.amount = 1),
  1,
  'copy preserves scheduled entry quantities and remaps through copied cells');
select is(
  (select day_type_override from public.food_plan_days where food_plan_id = (select id from copied_food_plan_result) and sort_order = 1),
  'partial',
  'copy preserves day type overrides');
select is(
  (select target_max from public.food_plan_daily_targets where food_plan_id = (select id from copied_food_plan_result) and metric = 'calories'),
  3000::numeric,
  'copy preserves daily target bounds');
select is(
  (select count(*)::int
   from public.meal_targets mt
   join public.meals m on m.id = mt.meal_id
   where mt.food_plan_id = (select id from copied_food_plan_result)
     and m.name = 'Dinner'
     and mt.metric = 'protein'
     and mt.target_min = 20),
  1,
  'copy remaps meal targets onto copied meals');
select is(
  (select count(*)::int from public.food_pack_state where food_plan_id = (select id from copied_food_plan_result)),
  0,
  'copy does not copy packed state');
select is(
  (select count(*)::int from public.food_plan_entries where food_plan_id = '82000000-0000-0000-0000-000000000001'),
  3,
  'source plan remains unchanged');

select throws_ok($$
  select public.copy_food_plan_to_list(
    '00000000-0000-0000-0000-0000000008a1',
    '82000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000003'
  )
$$, '22023', NULL, 'copy rejects a target list that already has a food plan');

select throws_ok($$
  select public.copy_food_plan_to_list(
    '00000000-0000-0000-0000-0000000008a1',
    '82000000-0000-0000-0000-000000000999',
    '83000000-0000-0000-0000-000000000002'
  )
$$, 'P0002', NULL, 'copy rejects an unknown source plan');

select throws_ok($$
  select public.copy_food_plan_to_list(
    '00000000-0000-0000-0000-0000000008a1',
    '82000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000004'
  )
$$, 'P0002', NULL, 'copy rejects a target list owned by another user');

select throws_ok($$
  select public.copy_food_plan_to_list(
    '00000000-0000-0000-0000-0000000008a2',
    '82000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000002'
  )
$$, '42501', NULL, 'copy rejects mismatched p_user_id');

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok($$
  select public.copy_food_plan_to_list(
    '00000000-0000-0000-0000-0000000008a1',
    '82000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000002'
  )
$$, '42501', NULL, 'anon cannot execute copy_food_plan_to_list');

select finish();
rollback;
