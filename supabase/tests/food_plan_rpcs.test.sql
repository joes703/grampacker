-- supabase/tests/food_plan_rpcs.test.sql
begin;
select plan(29);

create extension if not exists pgtap with schema extensions;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'rpcowner@test.dev'),
  ('00000000-0000-0000-0000-0000000000c2', 'rpcother@test.dev')
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

insert into public.lists (id, user_id, name, slug, sort_order)
values ('cc000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','Trip','rpcslug',0);
-- Bar: spp=4, weight=40 (merge math checkable). Spare: a second food (no spp).
insert into public.food_items (id, user_id, name, serving_weight_grams, calories_per_serving, servings_per_package)
values ('dd000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','Bar',40,150,4);
insert into public.food_items (id, user_id, name, serving_weight_grams, calories_per_serving)
values ('dd000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000c1','Spare',40,100);

-- == Block A: create (subset) ==
-- SUBSET grid (2 meals, 1 day, but only Breakfast scheduled - Dinner omitted).
select lives_ok($$
  select public.create_food_plan(
    '00000000-0000-0000-0000-0000000000c1','cc000000-0000-0000-0000-000000000001', 1,
    '[{"id":"a1000000-0000-0000-0000-000000000001","name":"Breakfast","anchor_role":"breakfast","is_default":true,"sort_order":0},
      {"id":"a1000000-0000-0000-0000-000000000002","name":"Dinner","anchor_role":"dinner","is_default":true,"sort_order":1}]'::jsonb,
    '[{"id":"a2000000-0000-0000-0000-000000000001","sort_order":0}]'::jsonb,
    '[{"id":"a3000000-0000-0000-0000-000000000001","day_id":"a2000000-0000-0000-0000-000000000001","meal_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
  )
$$, 'create_food_plan accepts an owner-chosen subset (Dinner omitted)');
select is((select count(*)::int from public.day_meals where food_plan_id=(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001')),
          1, 'only the scheduled cell was created (subset respected)');

insert into public.lists (id, user_id, name, slug, sort_order)
values ('cc000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000c1','Trip2','rpcslug2',1);
select throws_ok($$
  select public.create_food_plan(
    '00000000-0000-0000-0000-0000000000c1','cc000000-0000-0000-0000-000000000002', 1,
    '[{"id":"b1000000-0000-0000-0000-000000000001","name":"Breakfast","anchor_role":"breakfast","is_default":true,"sort_order":0}]'::jsonb,
    '[{"id":"b2000000-0000-0000-0000-000000000001","sort_order":0}]'::jsonb,
    '[{"id":"b3000000-0000-0000-0000-000000000001","day_id":"b2000000-0000-0000-0000-000000000001","meal_id":"b1000000-0000-0000-0000-000000000001"},
      {"id":"b3000000-0000-0000-0000-000000000002","day_id":"b2000000-0000-0000-0000-000000000001","meal_id":"b1000000-0000-0000-0000-000000000001"}]'::jsonb
  )
$$, '22023', NULL, 'a duplicate (day, meal) cell is rejected');

select throws_ok($$
  select public.create_food_plan('00000000-0000-0000-0000-0000000000c2','cc000000-0000-0000-0000-000000000001',1,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)
$$, '42501', NULL, 'create_food_plan rejects a mismatched p_user_id');

-- == Block B: schedule edits - custom Meal FIRST, then prove a new day omits it ==
-- Add a custom 'Lunch' while only day 0 exists (so it lands on the one existing day).
select lives_ok($$ select public.add_meal_definition('00000000-0000-0000-0000-0000000000c1',
  (select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001'), 'Lunch', 2) $$,
  'add_meal_definition adds a custom meal scheduled on every existing day');
select is((select count(*)::int from public.day_meals dm join public.meals m on m.id=dm.meal_id where m.name='Lunch'),
          1, 'the custom meal is scheduled on the one existing day');
-- Now add a NEW day. It must schedule ONLY the is_default meals (Breakfast, Dinner)
-- and must OMIT the custom 'Lunch'.
select lives_ok($$ select public.add_food_plan_day('00000000-0000-0000-0000-0000000000c1',
  (select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001'), 1) $$,
  'add_food_plan_day adds a day');
select is((select count(*)::int from public.day_meals dm join public.food_plan_days d on d.id=dm.day_id
           where d.sort_order=1 and d.food_plan_id=(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001')),
          2, 'the new day schedules only the two default meals');
select is((select count(*)::int from public.day_meals dm
           join public.food_plan_days d on d.id=dm.day_id
           join public.meals m on m.id=dm.meal_id
           where d.sort_order=1 and m.name='Lunch'
             and d.food_plan_id=(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001')),
          0, 'the new day OMITS the custom meal (default-only)');

-- == Block C: entry insert + merge value ==
select lives_ok($$
  select public.upsert_food_plan_entry('00000000-0000-0000-0000-0000000000c1',
    json_build_object('id','a4000000-0000-0000-0000-000000000001',
      'food_plan_id',(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001'),
      'day_meal_id','a3000000-0000-0000-0000-000000000001','is_extra',false,
      'food_item_id','dd000000-0000-0000-0000-000000000001','basis','servings','amount',2,'sort_order',0)::jsonb,
    null, null)
$$, 'upsert inserts a new entry (Bar, 2 servings, id ...0001)');
-- Merge a 1-package addition (= 4 servings), preserve servings => 6 on row ...0001.
-- p_entry.id ...0002 is unused (the merge updates the existing row).
select lives_ok($$
  select public.upsert_food_plan_entry('00000000-0000-0000-0000-0000000000c1',
    json_build_object('id','a4000000-0000-0000-0000-000000000002',
      'food_plan_id',(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001'),
      'day_meal_id','a3000000-0000-0000-0000-000000000001','is_extra',false,
      'food_item_id','dd000000-0000-0000-0000-000000000001','basis','packages','amount',1,'sort_order',0)::jsonb,
    'servings', null)
$$, 'upsert merges a packages addition into the servings cell');
select is((select amount from public.food_plan_entries where id='a4000000-0000-0000-0000-000000000001'),
          6::numeric, 'merge combined to 6 servings (2 + 1 package of 4) on the existing row');

-- == Block D: in-place move to an empty target + same-location no-op ==
-- Move the REAL row ...0001 (Bar) to Extras. In-place relocate keeps the same id.
select lives_ok($$
  select public.upsert_food_plan_entry('00000000-0000-0000-0000-0000000000c1',
    json_build_object('id','a4000000-0000-0000-0000-00000000000f',
      'food_plan_id',(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001'),
      'day_meal_id',null,'is_extra',true,
      'food_item_id','dd000000-0000-0000-0000-000000000001','basis','servings','amount',6,'sort_order',0)::jsonb,
    null, 'a4000000-0000-0000-0000-000000000001')
$$, 'move relocates row ...0001 to Extras');
select is((select count(*)::int from public.food_plan_entries
           where day_meal_id='a3000000-0000-0000-0000-000000000001' and food_item_id='dd000000-0000-0000-0000-000000000001'),
          0, 'the source breakfast cell is now empty for Bar');
select is((select is_extra from public.food_plan_entries where id='a4000000-0000-0000-0000-000000000001'),
          true, 'the SAME row ...0001 was relocated in place (no insert/delete)');
-- Same-location move of row ...0001 (Extras -> Extras) is a no-op.
select lives_ok($$
  select public.upsert_food_plan_entry('00000000-0000-0000-0000-0000000000c1',
    json_build_object('id','a4000000-0000-0000-0000-00000000000e',
      'food_plan_id',(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001'),
      'day_meal_id',null,'is_extra',true,
      'food_item_id','dd000000-0000-0000-0000-000000000001','basis','servings','amount',6,'sort_order',0)::jsonb,
    null, 'a4000000-0000-0000-0000-000000000001')
$$, 'a same-location move is a no-op');

-- == Block F: failed move leaves the occupied target unchanged ==
-- Put a Spare entry (3 servings) in the now-empty breakfast cell.
insert into public.food_plan_entries (id, user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order)
values ('a4000000-0000-0000-0000-0000000000bb','00000000-0000-0000-0000-0000000000c1',
  (select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001'),
  'a3000000-0000-0000-0000-000000000001', false, 'dd000000-0000-0000-0000-000000000002','servings',3,0);
select throws_ok($$
  select public.upsert_food_plan_entry('00000000-0000-0000-0000-0000000000c1',
    json_build_object('id','a4000000-0000-0000-0000-00000000cccc',
      'food_plan_id',(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001'),
      'day_meal_id','a3000000-0000-0000-0000-000000000001','is_extra',false,
      'food_item_id','dd000000-0000-0000-0000-000000000002','basis','servings','amount',5,'sort_order',0)::jsonb,
    null, '00000000-0000-0000-0000-0000deadbeef')
$$, 'P0002', NULL, 'a move with an unknown source id is rejected');
select is((select amount from public.food_plan_entries where id='a4000000-0000-0000-0000-0000000000bb'),
          3::numeric, 'the target Spare entry is unchanged after the failed move (atomic)');

-- == Block E: move-merge uses the live SOURCE quantity, not p_entry ==
-- Fresh plan: 1 day, Breakfast (h1) + Dinner (h2) scheduled, Spare in both cells.
insert into public.lists (id, user_id, name, slug, sort_order)
values ('cc000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000c1','MergeTrip','mergerpc',3);
select public.create_food_plan('00000000-0000-0000-0000-0000000000c1','cc000000-0000-0000-0000-000000000004', 1,
  '[{"id":"a1100000-0000-0000-0000-000000000001","name":"Breakfast","anchor_role":"breakfast","is_default":true,"sort_order":0},
    {"id":"a1100000-0000-0000-0000-000000000002","name":"Dinner","anchor_role":"dinner","is_default":true,"sort_order":1}]'::jsonb,
  '[{"id":"a2200000-0000-0000-0000-000000000001","sort_order":0}]'::jsonb,
  '[{"id":"a3300000-0000-0000-0000-000000000001","day_id":"a2200000-0000-0000-0000-000000000001","meal_id":"a1100000-0000-0000-0000-000000000001"},
    {"id":"a3300000-0000-0000-0000-000000000002","day_id":"a2200000-0000-0000-0000-000000000001","meal_id":"a1100000-0000-0000-0000-000000000002"}]'::jsonb);
insert into public.food_plan_entries (id, user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order)
values ('a4400000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1',(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000004'),'a3300000-0000-0000-0000-000000000001',false,'dd000000-0000-0000-0000-000000000002','servings',2,0),
       ('a4400000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000c1',(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000004'),'a3300000-0000-0000-0000-000000000002',false,'dd000000-0000-0000-0000-000000000002','servings',5,0);
-- Move the Dinner entry (source = 5 servings) into the Breakfast cell (has 2).
-- p_entry says amount 999; the RPC MUST ignore it and use the source's 5.
select lives_ok($$
  select public.upsert_food_plan_entry('00000000-0000-0000-0000-0000000000c1',
    json_build_object('id','a4400000-0000-0000-0000-000000000009',
      'food_plan_id',(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000004'),
      'day_meal_id','a3300000-0000-0000-0000-000000000001','is_extra',false,
      'food_item_id','dd000000-0000-0000-0000-000000000002','basis','servings','amount',999,'sort_order',0)::jsonb,
    null, 'a4400000-0000-0000-0000-000000000002')
$$, 'move-merge into an occupied cell');
select is((select amount from public.food_plan_entries where day_meal_id='a3300000-0000-0000-0000-000000000001' and food_item_id='dd000000-0000-0000-0000-000000000002'),
          7::numeric, 'merged to 7 servings from the SOURCE amount (2 + 5), ignoring p_entry amount (999)');

-- == Block G: move at the entry cap (in-place relocate, count unchanged) ==
insert into public.lists (id, user_id, name, slug, sort_order)
values ('cc000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000c1','CapTrip','caprpcslug',2);
insert into public.food_plans (id, user_id, list_id) values ('ee000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000c1','cc000000-0000-0000-0000-000000000003');
insert into public.meals (user_id, food_plan_id, name, sort_order)
select '00000000-0000-0000-0000-0000000000c1','ee000000-0000-0000-0000-000000000003','CM'||g, g from generate_series(1,20) g;
insert into public.food_plan_days (user_id, food_plan_id, sort_order)
select '00000000-0000-0000-0000-0000000000c1','ee000000-0000-0000-0000-000000000003', g from generate_series(1,50) g;
insert into public.day_meals (user_id, food_plan_id, day_id, meal_id)
select '00000000-0000-0000-0000-0000000000c1','ee000000-0000-0000-0000-000000000003', d.id, m.id
from public.food_plan_days d cross join public.meals m
where d.food_plan_id='ee000000-0000-0000-0000-000000000003' and m.food_plan_id='ee000000-0000-0000-0000-000000000003';
insert into public.food_plan_entries (user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order)
select '00000000-0000-0000-0000-0000000000c1','ee000000-0000-0000-0000-000000000003', dm.id, false, f.fid, 'servings', 1, 0
from public.day_meals dm
cross join (values ('dd000000-0000-0000-0000-000000000001'::uuid),('dd000000-0000-0000-0000-000000000002'::uuid)) f(fid)
where dm.food_plan_id='ee000000-0000-0000-0000-000000000003';
select lives_ok($$
  with one as (
    select e.id from public.food_plan_entries e
    where e.food_plan_id='ee000000-0000-0000-0000-000000000003' and e.food_item_id='dd000000-0000-0000-0000-000000000001' limit 1
  )
  select public.upsert_food_plan_entry('00000000-0000-0000-0000-0000000000c1',
    json_build_object('id','a4000000-0000-0000-0000-00000000ca01',
      'food_plan_id','ee000000-0000-0000-0000-000000000003','day_meal_id',null,'is_extra',true,
      'food_item_id','dd000000-0000-0000-0000-000000000001','basis','servings','amount',1,'sort_order',0)::jsonb,
    null, (select id from one))
$$, 'a move to an empty target succeeds at the 2000-entry cap (in-place relocate)');
select is((select count(*)::int from public.food_plan_entries where food_plan_id='ee000000-0000-0000-0000-000000000003'),
          2000, 'the entry count is unchanged after the move at cap');

-- == Block H: duplicate-day fidelity (food_item_id / basis / amount / sort_order) ==
-- Day 0 of plan cc...0001 now has Breakfast (Spare 3 servings) + Lunch (empty).
select lives_ok($$ select public.duplicate_food_plan_day('00000000-0000-0000-0000-0000000000c1','a2000000-0000-0000-0000-000000000001', 9) $$,
  'duplicate_food_plan_day copies the live source day');
select is((select count(*)::int from public.day_meals dm join public.food_plan_days d on d.id=dm.day_id
           where d.sort_order=9 and d.food_plan_id=(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001')),
          2, 'the duplicated day mirrors the source schedule (Breakfast + Lunch)');
select is((select e.food_item_id from public.food_plan_entries e
           join public.day_meals dm on dm.id=e.day_meal_id join public.food_plan_days d on d.id=dm.day_id
           where d.sort_order=9 and d.food_plan_id=(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001')),
          'dd000000-0000-0000-0000-000000000002'::uuid, 'duplicated entry copies food_item_id');
select is((select e.basis from public.food_plan_entries e
           join public.day_meals dm on dm.id=e.day_meal_id join public.food_plan_days d on d.id=dm.day_id
           where d.sort_order=9 and d.food_plan_id=(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001')),
          'servings', 'duplicated entry copies basis');
select is((select e.amount from public.food_plan_entries e
           join public.day_meals dm on dm.id=e.day_meal_id join public.food_plan_days d on d.id=dm.day_id
           where d.sort_order=9 and d.food_plan_id=(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001')),
          3::numeric, 'duplicated entry copies amount');
select is((select e.sort_order from public.food_plan_entries e
           join public.day_meals dm on dm.id=e.day_meal_id join public.food_plan_days d on d.id=dm.day_id
           where d.sort_order=9 and d.food_plan_id=(select id from public.food_plans where list_id='cc000000-0000-0000-0000-000000000001')),
          0, 'duplicated entry copies sort_order');

-- == Block I: meals reorder ==
select lives_ok($$
  select public.bulk_update_sort_order('meals',
    array['a1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001']::uuid[], array[0,1]::int[])
$$, 'bulk_update_sort_order reorders meals');

select finish();
rollback;
