-- supabase/tests/food_plan_tables.test.sql
begin;
select plan(16);

create extension if not exists pgtap with schema extensions;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'planowner@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'planother@test.dev')
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

insert into public.lists (id, user_id, name, slug, sort_order)
values ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'Trip', 'plslg1', 0);
-- food1 has servings_per_package; food2 does NOT (drives the basis-validation test);
-- food3 is a spare used only for the 2001st-entry cap assertion.
insert into public.food_items (id, user_id, name, serving_weight_grams, calories_per_serving, servings_per_package)
values ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'Oats', 50, 180, 4);
insert into public.food_items (id, user_id, name, serving_weight_grams, calories_per_serving)
values ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', 'Loose', 50, 100);
insert into public.food_items (id, user_id, name, serving_weight_grams, calories_per_serving)
values ('d0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1', 'Spare', 50, 100);

select lives_ok($$
  insert into public.food_plans (id, user_id, list_id, num_nights)
  values ('e0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-000000000001', 3)
$$, 'owner creates a plan');

select throws_ok($$
  insert into public.food_plans (user_id, list_id, num_nights)
  values ('00000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-000000000001', 2)
$$, '23505', NULL, 'a second plan on the same list is rejected (unique list_id)');

insert into public.meals (id, user_id, food_plan_id, name, anchor_role, is_default, sort_order)
values ('11110000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000001','Breakfast','breakfast',true,0);

select throws_ok($$
  insert into public.meals (user_id, food_plan_id, name, anchor_role, sort_order)
  values ('00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000001','Second Breakfast','breakfast',1)
$$, '23505', NULL, 'two breakfast anchors in one plan are rejected (anchor unique index)');

insert into public.food_plan_days (id, user_id, food_plan_id, sort_order)
values ('22220000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000001',0);
insert into public.day_meals (id, user_id, food_plan_id, day_id, meal_id)
values ('33330000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000001','22220000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001');

select lives_ok($$
  insert into public.food_plan_entries (user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order)
  values ('00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000001','33330000-0000-0000-0000-000000000001', false,'d0000000-0000-0000-0000-000000000001','servings',2,0)
$$, 'owner adds an entry to a cell');

select throws_ok($$
  insert into public.food_plan_entries (user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order)
  values ('00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000001','33330000-0000-0000-0000-000000000001', false,'d0000000-0000-0000-0000-000000000001','servings',5,1)
$$, '23505', NULL, 'a second entry for the same food in the same cell is rejected (per-cell unique)');

select throws_ok($$
  insert into public.food_plan_entries (user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order)
  values ('00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000001', null, false,'d0000000-0000-0000-0000-000000000001','servings',1,2)
$$, '23514', NULL, 'an entry with no location and is_extra=false is rejected (entry_location_xor)');

select throws_ok($$
  insert into public.food_plan_entries (user_id, food_plan_id, is_extra, food_item_id, basis, amount, sort_order)
  values ('00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000001', true,'d0000000-0000-0000-0000-000000000001','servings',0,3)
$$, '23514', NULL, 'amount must be > 0');

select throws_ok($$
  insert into public.food_plan_entries (user_id, food_plan_id, is_extra, food_item_id, basis, amount, sort_order)
  values ('00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000001', true,'d0000000-0000-0000-0000-000000000002','packages',1,4)
$$, '22023', NULL, 'packages basis without servings_per_package is rejected (unknown never becomes zero)');

insert into public.lists (id, user_id, name, slug, sort_order)
values ('c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b1','Trip2','plslg2',1);
insert into public.food_plans (id, user_id, list_id, num_nights)
values ('e0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-000000000002',1);
select throws_ok($$
  insert into public.day_meals (user_id, food_plan_id, day_id, meal_id)
  values ('00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000002','22220000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001')
$$, '23503', NULL, 'a day_meal cannot reference a day/meal from a different plan (composite FK)');

-- Meal cap: plan e1 has 1 meal; add 19 more = 20, 21st fails.
insert into public.meals (user_id, food_plan_id, name, sort_order)
select '00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000001','M' || g, g from generate_series(1, 19) g;
select throws_ok($$
  insert into public.meals (user_id, food_plan_id, name, sort_order)
  values ('00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000001','Over',99)
$$, 'P0001', NULL, 'the 21st meal in a plan is rejected by the cap trigger');

-- Day cap: plan e1 has 1 day; add 59 more = 60, 61st fails.
insert into public.food_plan_days (user_id, food_plan_id, sort_order)
select '00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000001', g from generate_series(1, 59) g;
select throws_ok($$
  insert into public.food_plan_days (user_id, food_plan_id, sort_order)
  values ('00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000001', 999)
$$, 'P0001', NULL, 'the 61st day in a plan is rejected by the cap trigger');

-- Entry cap (2000): fresh plan, 50 days x 20 meals = 1000 cells, 2 foods each =
-- 2000 entries; the 2001st uses a THIRD food in some cell (not yet present there),
-- so it clears the per-cell unique and provably trips the cap trigger.
insert into public.lists (id, user_id, name, slug, sort_order)
values ('c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000b1','CapTrip','plslg3',2);
insert into public.food_plans (id, user_id, list_id)
values ('e0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-000000000003');
insert into public.meals (user_id, food_plan_id, name, sort_order)
select '00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000003','CM'||g, g from generate_series(1,20) g;
insert into public.food_plan_days (user_id, food_plan_id, sort_order)
select '00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000003', g from generate_series(1,50) g;
insert into public.day_meals (user_id, food_plan_id, day_id, meal_id)
select '00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000003', d.id, m.id
from public.food_plan_days d cross join public.meals m
where d.food_plan_id='e0000000-0000-0000-0000-000000000003' and m.food_plan_id='e0000000-0000-0000-0000-000000000003';
insert into public.food_plan_entries (user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order)
select '00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000003', dm.id, false, f.fid, 'servings', 1, 0
from public.day_meals dm
cross join (values ('d0000000-0000-0000-0000-000000000001'::uuid), ('d0000000-0000-0000-0000-000000000002'::uuid)) f(fid)
where dm.food_plan_id='e0000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from public.food_plan_entries where food_plan_id='e0000000-0000-0000-0000-000000000003'),
  2000, 'plan is at the 2000-entry cap');
select throws_ok($$
  insert into public.food_plan_entries (user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order)
  select '00000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000003', dm.id, false,
         'd0000000-0000-0000-0000-000000000003', 'servings', 1, 99
  from public.day_meals dm where dm.food_plan_id='e0000000-0000-0000-0000-000000000003' limit 1
$$, 'P0001', NULL, 'the 2001st entry (a third food, no per-cell clash) is rejected by the cap trigger');

-- Cascade.
delete from public.food_plans where id = 'e0000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.meals where food_plan_id = 'e0000000-0000-0000-0000-000000000001'), 0, 'deleting a plan cascades its meals');

-- Cross-owner isolation.
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from public.food_plans where user_id = '00000000-0000-0000-0000-0000000000b1'), 0, 'non-owner sees zero of another users plans');

-- Grant matrix.
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema='public' and grantee='anon'
     and table_name in ('food_plans','meals','food_plan_days','day_meals','food_plan_entries')),
  0, 'anon has NO grant on any food plan table');

select finish();
rollback;
