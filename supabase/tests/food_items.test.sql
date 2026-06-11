-- supabase/tests/food_items.test.sql
begin;
select plan(22);

create extension if not exists pgtap with schema extensions;

-- Two fixture users so cross-owner isolation can be asserted.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'other@test.dev')
on conflict (id) do nothing;

-- ---- Act as the owner ----
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$
  insert into public.food_items (user_id, name, serving_weight_grams, calories_per_serving)
  values ('00000000-0000-0000-0000-0000000000a1', 'Peanut Butter', 32, 190)
$$, 'owner can insert a food with only the required fields');

select is(
  (select count(*)::int from public.food_items where name = 'Peanut Butter'),
  1, 'owner sees their own food');

-- Owner UPDATE.
select lives_ok($$
  update public.food_items set calories_per_serving = 200 where name = 'Peanut Butter'
$$, 'owner can update their own food');

select is(
  (select calories_per_serving from public.food_items where name = 'Peanut Butter'),
  200::numeric, 'owner update is applied');

-- Required-field and bound constraints.
select throws_ok($$
  insert into public.food_items (user_id, name, serving_weight_grams, calories_per_serving)
  values ('00000000-0000-0000-0000-0000000000a1', 'Bad', 0, 100)
$$, '23514', NULL, 'serving_weight_grams > 0 is enforced (check_violation)');

select throws_ok($$
  insert into public.food_items (user_id, name, serving_weight_grams, calories_per_serving)
  values ('00000000-0000-0000-0000-0000000000a1', 'NoCalories', 50, NULL)
$$, '23502', NULL, 'calories_per_serving is NOT NULL (not_null_violation)');

select throws_ok($$
  insert into public.food_items (user_id, name, serving_weight_grams, calories_per_serving)
  values ('00000000-0000-0000-0000-0000000000a1', '', 50, 100)
$$, '23514', NULL, 'name length lower bound is enforced (check_violation)');

-- ---- Cross-owner isolation: act as the other user ----
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is(
  (select count(*)::int from public.food_items where user_id = '00000000-0000-0000-0000-0000000000a1'),
  0, 'a non-owner sees zero rows of another users food (RLS row isolation)');

select throws_ok($$
  insert into public.food_items (user_id, name, serving_weight_grams, calories_per_serving)
  values ('00000000-0000-0000-0000-0000000000a1', 'Spoofed', 50, 100)
$$, '42501', NULL, 'a user cannot insert a row owned by someone else (RLS with check)');

-- Non-owner UPDATE / DELETE match zero rows under RLS (no error, no effect).
select lives_ok($$
  update public.food_items set calories_per_serving = 1 where user_id = '00000000-0000-0000-0000-0000000000a1'
$$, 'non-owner update runs but matches no rows');

select lives_ok($$
  delete from public.food_items where user_id = '00000000-0000-0000-0000-0000000000a1'
$$, 'non-owner delete runs but matches no rows');

-- ---- Back to the owner: confirm the non-owner writes did not apply ----
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select calories_per_serving from public.food_items where name = 'Peanut Butter'),
  200::numeric, 'non-owner update did NOT change the owners row');

select is(
  (select count(*)::int from public.food_items where name = 'Peanut Butter'),
  1, 'non-owner delete did NOT remove the owners row');

-- Owner DELETE (on a throwaway row so the cap section still starts at 1).
insert into public.food_items (user_id, name, serving_weight_grams, calories_per_serving)
values ('00000000-0000-0000-0000-0000000000a1', 'Temp', 50, 100);

select lives_ok($$
  delete from public.food_items where name = 'Temp'
$$, 'owner can delete their own food');

select is(
  (select count(*)::int from public.food_items where name = 'Temp'),
  0, 'owner delete is applied');

-- ---- Cap: owner has exactly 1 row; fill to 1000, assert the 1001st fails ----
insert into public.food_items (user_id, name, serving_weight_grams, calories_per_serving)
select '00000000-0000-0000-0000-0000000000a1', 'Bulk ' || g, 50, 100
from generate_series(1, 999) as g;

select is(
  (select count(*)::int from public.food_items where user_id = '00000000-0000-0000-0000-0000000000a1'),
  1000, 'owner is at the 1000-food cap');

select throws_ok($$
  insert into public.food_items (user_id, name, serving_weight_grams, calories_per_serving)
  values ('00000000-0000-0000-0000-0000000000a1', 'One Too Many', 50, 100)
$$, 'P0001', NULL, 'the 1001st insert is rejected by the cap trigger (raise_exception)');

-- ---- Grant matrix (reachability) ----
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'food_items' and grantee = 'anon'),
  0, 'anon has NO grant on food_items');

select bag_eq(
  $$ select privilege_type::text from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'food_items' and grantee = 'authenticated' $$,
  $$ values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE') $$,
  'authenticated has full CRUD on food_items');

-- The cap trigger function must not be callable as an RPC by anon/authenticated
-- (has_function_privilege accounts for PUBLIC inheritance).
select ok(
  not has_function_privilege('anon', 'public.check_food_item_limit()', 'execute'),
  'anon cannot execute check_food_item_limit');

select ok(
  not has_function_privilege('authenticated', 'public.check_food_item_limit()', 'execute'),
  'authenticated cannot execute check_food_item_limit');

select finish();
rollback;
