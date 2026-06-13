-- supabase/tests/food_plan_targets.test.sql
begin;
select plan(29);

create extension if not exists pgtap with schema extensions;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'tgtowner@test.dev'),
  ('00000000-0000-0000-0000-0000000000c2', 'tgtother@test.dev')
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- Fixtures owned by c1: two lists/plans (slugs are EXACTLY 6 chars) and a meal on plan e1.
insert into public.lists (id, user_id, name, slug, sort_order) values
  ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'Trip',  'tgtsl1', 0),
  ('c1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1', 'Trip2', 'tgtsl2', 1);
insert into public.food_plans (id, user_id, list_id, num_nights) values
  ('e1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'c1000000-0000-0000-0000-000000000001', 2),
  ('e1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1', 'c1000000-0000-0000-0000-000000000002', 1);
insert into public.meals (id, user_id, food_plan_id, name, sort_order)
values ('11100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'e1000000-0000-0000-0000-000000000001', 'Breakfast', 0);

-- A) Positive controls: every mode shape that must be accepted ---------------
select lives_ok($$
  insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode, target_min, target_max)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','calories','range',2500,3500)
$$, 'owner creates a range daily target');
select lives_ok($$
  insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode, target_min)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','calorie_density','min',4.5)
$$, 'owner creates a one-sided min calorie-density floor');
select lives_ok($$
  insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','protein','off')
$$, 'owner creates an off daily target with both bounds null');
select lives_ok($$
  insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode, target_max)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','sodium','max',2300)
$$, 'owner creates a one-sided max sodium ceiling');
select lives_ok($$
  insert into public.meal_targets (user_id, food_plan_id, meal_id, metric, mode, target_min, target_max)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','11100000-0000-0000-0000-000000000001','fat_pct','range',20,40)
$$, 'owner creates a meal fat_pct range target');

-- B) Bounds / mode invariants (every rejection) ------------------------------
select throws_ok($$
  insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode, target_min)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','fiber','off',100)
$$, '23514', NULL, 'mode=off with a non-null bound is rejected');
select throws_ok($$
  insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode, target_min, target_max)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','fiber','min',30,40)
$$, '23514', NULL, 'mode=min carrying a stray target_max is rejected');
select throws_ok($$
  insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode, target_min, target_max)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','fiber','max',30,40)
$$, '23514', NULL, 'mode=max carrying a stray target_min is rejected');
select throws_ok($$
  insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode, target_min, target_max)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','fiber','range',900,500)
$$, '23514', NULL, 'mode=range with min > max is rejected');
select throws_ok($$
  insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode, target_min)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','fiber','range',1000)
$$, '23514', NULL, 'mode=range missing one bound is rejected');
select throws_ok($$
  insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode, target_min)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','fiber','min',-10)
$$, '23514', NULL, 'a negative bound is rejected');
select throws_ok($$
  insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode, target_min, target_max)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','nonsense','range',1,2)
$$, '23514', NULL, 'an unknown daily metric is rejected');

-- C) Uniqueness --------------------------------------------------------------
select throws_ok($$
  insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode, target_min, target_max)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','calories','range',2000,3000)
$$, '23505', NULL, 'a second daily target for the same metric is rejected');
select throws_ok($$
  insert into public.meal_targets (user_id, food_plan_id, meal_id, metric, mode, target_min, target_max)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','11100000-0000-0000-0000-000000000001','fat_pct','range',10,30)
$$, '23505', NULL, 'a second meal target for the same metric is rejected');

-- D) Meal bounds + percent ceiling (meal only) + cross-plan FK ---------------
select throws_ok($$
  insert into public.meal_targets (user_id, food_plan_id, meal_id, metric, mode, target_min, target_max)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','11100000-0000-0000-0000-000000000001','protein','min',20,40)
$$, '23514', NULL, 'a malformed meal target (min carrying target_max) is rejected by meal_target_bounds');
select throws_ok($$
  insert into public.meal_targets (user_id, food_plan_id, meal_id, metric, mode, target_max)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','11100000-0000-0000-0000-000000000001','sugar_pct','max',150)
$$, '23514', NULL, 'a fat_pct/sugar_pct bound above 100 is rejected');
select throws_ok($$
  insert into public.meal_targets (user_id, food_plan_id, meal_id, metric, mode, target_min)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000002','11100000-0000-0000-0000-000000000001','calories','min',400)
$$, '23503', NULL, 'a meal target cannot reference a meal from a different plan (composite FK)');

-- E) Cross-tenant isolation: c2 acts while c1's rows STILL EXIST -------------
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select is(
  (select count(*)::int from public.food_plan_daily_targets),
  0, 'c2 reads zero of c1 daily targets (owner RLS hides them)');
select is(
  (select count(*)::int from public.meal_targets),
  0, 'c2 reads zero of c1 meal targets (independent owner RLS hides them)');
select throws_ok($$
  insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode, target_min)
  values ('00000000-0000-0000-0000-0000000000c1','e1000000-0000-0000-0000-000000000001','fiber','min',30)
$$, '42501', NULL, 'c2 cannot insert a row owned by c1 (RLS WITH CHECK)');
-- A data-modifying CTE must attach to the TOP LEVEL of the statement; it cannot
-- be nested inside a scalar sub-select. So the WITH leads the SELECT and is()
-- reads the CTE from a sub-select in its first argument.
with u as (
  update public.food_plan_daily_targets set target_min = 9999
  where food_plan_id = 'e1000000-0000-0000-0000-000000000001' and metric = 'calories'
  returning 1)
select is((select count(*)::int from u),
  0, 'c2 update of c1 daily target affects zero rows (RLS USING hides it)');
with d as (
  delete from public.food_plan_daily_targets
  where food_plan_id = 'e1000000-0000-0000-0000-000000000001' and metric = 'calories'
  returning 1)
select is((select count(*)::int from d),
  0, 'c2 delete of c1 daily target affects zero rows (RLS USING hides it)');

-- F) Cascade: back as c1, deleting the plan removes its targets ---------------
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is(
  (select count(*)::int from public.food_plan_daily_targets where food_plan_id = 'e1000000-0000-0000-0000-000000000001'),
  4, 'c1 plan e1 still has its four daily targets (c2 changed nothing)');
delete from public.food_plans where id = 'e1000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.food_plan_daily_targets where food_plan_id = 'e1000000-0000-0000-0000-000000000001'),
  0, 'deleting a plan cascades its daily targets');
select is(
  (select count(*)::int from public.meal_targets where food_plan_id = 'e1000000-0000-0000-0000-000000000001'),
  0, 'deleting a plan cascades its meal targets');

-- G) Grant matrix (mirrors food_items.test.sql) ------------------------------
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'food_plan_daily_targets' and grantee = 'anon'),
  0, 'anon has NO grant on food_plan_daily_targets');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'meal_targets' and grantee = 'anon'),
  0, 'anon has NO grant on meal_targets');
select bag_eq(
  $$ select privilege_type::text from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'food_plan_daily_targets' and grantee = 'authenticated' $$,
  $$ values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE') $$,
  'authenticated has full CRUD on food_plan_daily_targets');
select bag_eq(
  $$ select privilege_type::text from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'meal_targets' and grantee = 'authenticated' $$,
  $$ values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE') $$,
  'authenticated has full CRUD on meal_targets');

select finish();
rollback;
