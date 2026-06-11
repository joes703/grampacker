-- supabase/tests/food_items.test.sql
begin;
select plan(11);

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

-- ---- Cap: act as the owner, fill to 1000, assert the 1001st fails ----
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- One row already exists (Peanut Butter); add 999 more to reach 1000.
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

select finish();
rollback;
