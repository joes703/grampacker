-- supabase/tests/delete_account_cascade.test.sql
--
-- Account deletion must leave NO food data behind. delete_account() deletes the
-- caller's auth.users row and relies entirely on FK ON DELETE CASCADE:
--   auth.users -> public.profiles -> every food table (user_id ... on delete cascade).
-- This test seeds one user with full food data across all ten food tables
-- (INCLUDING food_pack_state, which the takeout export omits but deletion must
-- still wipe), then deletes the auth.users row and asserts everything is gone.
-- Deleting auth.users directly exercises the exact cascade delete_account() fires.
begin;
select plan(22);

create extension if not exists pgtap with schema extensions;

-- Seed the user. handle_new_user() auto-creates the public.profiles row.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000009a1', 'takeout-delete@test.dev')
on conflict (id) do nothing;

insert into public.lists (id, user_id, name, description, slug, is_shared, sort_order, group_worn, is_draft) values
  ('6a000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000009a1', 'Delete Trip', null, 'del001', false, 0, false, true);

insert into public.food_items (
  id, user_id, name, brand, serving_description, serving_weight_grams, calories_per_serving,
  servings_per_package, notes, sort_order
) values
  ('6b000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000009a1', 'Oats', null, 'cup', 80, 300, null, null, 0);

insert into public.food_plans (id, user_id, list_id, is_food_shared) values
  ('6c000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000009a1', '6a000000-0000-0000-0000-000000000001', false);

insert into public.meals (id, user_id, food_plan_id, name, anchor_role, is_default, sort_order) values
  ('6d000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000009a1', '6c000000-0000-0000-0000-000000000001', 'On-trail food', null, true, 0);

insert into public.food_plan_days (id, user_id, food_plan_id, sort_order) values
  ('6e000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000009a1', '6c000000-0000-0000-0000-000000000001', 0);

insert into public.day_meals (id, user_id, food_plan_id, day_id, meal_id) values
  ('6f000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000009a1', '6c000000-0000-0000-0000-000000000001',
   '6e000000-0000-0000-0000-000000000001', '6d000000-0000-0000-0000-000000000001');

insert into public.food_plan_entries (
  id, user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order
) values
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000009a1', '6c000000-0000-0000-0000-000000000001',
   '6f000000-0000-0000-0000-000000000001', false, '6b000000-0000-0000-0000-000000000001', 'servings', 1, 0),
  ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000009a1', '6c000000-0000-0000-0000-000000000001',
   null, true, '6b000000-0000-0000-0000-000000000001', 'servings', 1, 10);

insert into public.food_plan_daily_targets (id, user_id, food_plan_id, metric, mode, target_min, target_max) values
  ('71000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000009a1', '6c000000-0000-0000-0000-000000000001',
   'calories', 'range', 2000, 3000);

insert into public.meal_targets (id, user_id, food_plan_id, meal_id, metric, mode, target_min, target_max) values
  ('72000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000009a1', '6c000000-0000-0000-0000-000000000001',
   '6d000000-0000-0000-0000-000000000001', 'calories', 'min', 500, null);

insert into public.food_plan_target_defaults (id, user_id, metric, mode, target_min, target_max) values
  ('73000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000009a1', 'protein', 'min', 100, null);

insert into public.food_pack_state (id, user_id, food_plan_id, food_item_id, is_packed, packed_signature) values
  ('74000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000009a1', '6c000000-0000-0000-0000-000000000001',
   '6b000000-0000-0000-0000-000000000001', true, 'sig1');

-- 1-11. Pre-delete: the user's data exists (guards against a vacuous pass).
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000009a1'), 1, 'pre: profiles row exists');
select is((select count(*)::int from public.food_items where user_id = '00000000-0000-0000-0000-0000000009a1'), 1, 'pre: food_items seeded');
select is((select count(*)::int from public.food_plans where user_id = '00000000-0000-0000-0000-0000000009a1'), 1, 'pre: food_plans seeded');
select is((select count(*)::int from public.meals where user_id = '00000000-0000-0000-0000-0000000009a1'), 1, 'pre: meals seeded');
select is((select count(*)::int from public.food_plan_days where user_id = '00000000-0000-0000-0000-0000000009a1'), 1, 'pre: food_plan_days seeded');
select is((select count(*)::int from public.day_meals where user_id = '00000000-0000-0000-0000-0000000009a1'), 1, 'pre: day_meals seeded');
select is((select count(*)::int from public.food_plan_entries where user_id = '00000000-0000-0000-0000-0000000009a1'), 2, 'pre: food_plan_entries seeded');
select is((select count(*)::int from public.food_plan_daily_targets where user_id = '00000000-0000-0000-0000-0000000009a1'), 1, 'pre: food_plan_daily_targets seeded');
select is((select count(*)::int from public.meal_targets where user_id = '00000000-0000-0000-0000-0000000009a1'), 1, 'pre: meal_targets seeded');
select is((select count(*)::int from public.food_plan_target_defaults where user_id = '00000000-0000-0000-0000-0000000009a1'), 1, 'pre: food_plan_target_defaults seeded');
select is((select count(*)::int from public.food_pack_state where user_id = '00000000-0000-0000-0000-0000000009a1'), 1, 'pre: food_pack_state seeded');

-- Fire the cascade. This is exactly what delete_account() does for auth.uid().
delete from auth.users where id = '00000000-0000-0000-0000-0000000009a1';

-- 12-22. Post-delete: every food table and the profiles chain anchor are empty.
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000009a1'), 0, 'post: profiles row gone');
select is((select count(*)::int from public.food_items where user_id = '00000000-0000-0000-0000-0000000009a1'), 0, 'post: food_items gone');
select is((select count(*)::int from public.food_plans where user_id = '00000000-0000-0000-0000-0000000009a1'), 0, 'post: food_plans gone');
select is((select count(*)::int from public.meals where user_id = '00000000-0000-0000-0000-0000000009a1'), 0, 'post: meals gone');
select is((select count(*)::int from public.food_plan_days where user_id = '00000000-0000-0000-0000-0000000009a1'), 0, 'post: food_plan_days gone');
select is((select count(*)::int from public.day_meals where user_id = '00000000-0000-0000-0000-0000000009a1'), 0, 'post: day_meals gone');
select is((select count(*)::int from public.food_plan_entries where user_id = '00000000-0000-0000-0000-0000000009a1'), 0, 'post: food_plan_entries gone');
select is((select count(*)::int from public.food_plan_daily_targets where user_id = '00000000-0000-0000-0000-0000000009a1'), 0, 'post: food_plan_daily_targets gone');
select is((select count(*)::int from public.meal_targets where user_id = '00000000-0000-0000-0000-0000000009a1'), 0, 'post: meal_targets gone');
select is((select count(*)::int from public.food_plan_target_defaults where user_id = '00000000-0000-0000-0000-0000000009a1'), 0, 'post: food_plan_target_defaults gone');
select is((select count(*)::int from public.food_pack_state where user_id = '00000000-0000-0000-0000-0000000009a1'), 0, 'post: food_pack_state gone');

select * from finish();
rollback;
