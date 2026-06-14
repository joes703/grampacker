-- supabase/tests/food_pack_state.test.sql
begin;
select plan(65);  -- 20 (shape/grants/CHECK) + 15 (fn grants) + 5 (signature/reset) + 9 (pack) + 7 (merge/cleanup) + 2 (incomplete) + 7 (isolation)

create extension if not exists pgtap with schema extensions;

-- ---- fixtures: A = owner under test, B = attacker. Profiles backfill via the
-- handle_new_user trigger on the auth.users insert (no explicit profiles insert).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000aa', 'packowner@test.dev'),
  ('00000000-0000-0000-0000-0000000000bb', 'packother@test.dev')
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}';

insert into public.lists (id, user_id, name, slug, sort_order)
  values ('c0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000aa', 'Trip', 'trip-a', 0);
insert into public.food_plans (id, user_id, list_id)
  values ('e0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000aa', 'c0000000-0000-0000-0000-0000000000a1');
insert into public.food_items (id, user_id, name, serving_weight_grams, calories_per_serving, servings_per_package)
  values ('d0000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000aa', 'Oats', 50, 190, 4);
insert into public.food_items (id, user_id, name, serving_weight_grams, calories_per_serving)
  values ('d0000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000aa', 'Bar', 40, 200);
insert into public.food_plan_days (id, user_id, food_plan_id, sort_order)
  values ('22220000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000aa', 'e0000000-0000-0000-0000-0000000000a2', 0);
insert into public.meals (id, user_id, food_plan_id, name, sort_order)
  values ('11110000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000aa', 'e0000000-0000-0000-0000-0000000000a2', 'Breakfast', 0);
insert into public.day_meals (id, user_id, food_plan_id, day_id, meal_id)
  values ('33330000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000aa', 'e0000000-0000-0000-0000-0000000000a2',
          '22220000-0000-0000-0000-0000000000a5', '11110000-0000-0000-0000-0000000000a6');
-- Oats: 2 servings + 1 package(=4 servings) -> 6 servings -> 300 g. Bar: 100 g weight.
insert into public.food_plan_entries (user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order) values
  ('00000000-0000-0000-0000-0000000000aa', 'e0000000-0000-0000-0000-0000000000a2', '33330000-0000-0000-0000-0000000000a7', false, 'd0000000-0000-0000-0000-0000000000a3', 'servings', 2, 0),
  ('00000000-0000-0000-0000-0000000000aa', 'e0000000-0000-0000-0000-0000000000a2', null, true,  'd0000000-0000-0000-0000-0000000000a3', 'packages', 1, 1),
  ('00000000-0000-0000-0000-0000000000aa', 'e0000000-0000-0000-0000-0000000000a2', '33330000-0000-0000-0000-0000000000a7', false, 'd0000000-0000-0000-0000-0000000000a4', 'weight',   100, 0);

-- ===== Step 2: shape, RLS, grants, CHECK (20) =====
select has_table('public', 'food_pack_state', 'food_pack_state exists');
select col_is_pk('public', 'food_pack_state', 'id', 'id is pk');
select col_not_null('public', 'food_pack_state', 'packed_signature', 'packed_signature not null');
select has_index('public', 'food_pack_state', 'food_pack_state_key', 'unique (food_plan_id, food_item_id)');
select has_index('public', 'food_pack_state', 'food_pack_state_plan_idx', '(food_plan_id, user_id) FK index');
select is((select count(*)::int from pg_policies where schemaname='public' and tablename='food_pack_state'),
          1, 'exactly one policy (advisor-clean single FOR ALL)');
select is(has_table_privilege('anon','public.food_pack_state','SELECT'), false, 'anon cannot select');
select is(has_table_privilege('anon','public.food_pack_state','INSERT'), false, 'anon cannot insert');
select is(has_table_privilege('anon','public.food_pack_state','UPDATE'), false, 'anon cannot update');
select is(has_table_privilege('anon','public.food_pack_state','DELETE'), false, 'anon cannot delete');
select is(has_table_privilege('authenticated','public.food_pack_state','SELECT'), true, 'authenticated select');
select is(has_table_privilege('authenticated','public.food_pack_state','INSERT'), true, 'authenticated insert');
select is(has_table_privilege('authenticated','public.food_pack_state','UPDATE'), true, 'authenticated update');
select is(has_table_privilege('authenticated','public.food_pack_state','DELETE'), true, 'authenticated delete');
select is(has_table_privilege('service_role','public.food_pack_state','SELECT'), true, 'service_role select');
select is(has_table_privilege('service_role','public.food_pack_state','INSERT'), true, 'service_role insert');
select is(has_table_privilege('service_role','public.food_pack_state','UPDATE'), true, 'service_role update');
select is(has_table_privilege('service_role','public.food_pack_state','DELETE'), true, 'service_role delete');
select throws_ok(
  $$ insert into public.food_pack_state (user_id, food_plan_id, food_item_id, is_packed, packed_signature)
     values ('00000000-0000-0000-0000-0000000000aa','e0000000-0000-0000-0000-0000000000a2','d0000000-0000-0000-0000-0000000000a3', true, '') $$,
  '23514', NULL, 'packed row requires a non-empty signature');
select throws_ok(
  $$ insert into public.food_pack_state (user_id, food_plan_id, food_item_id, is_packed, packed_signature)
     values ('00000000-0000-0000-0000-0000000000aa','e0000000-0000-0000-0000-0000000000a2','d0000000-0000-0000-0000-0000000000a3', false, '300|50') $$,
  '23514', NULL, 'unpacked row must have empty signature');

-- ===== Step 3: function execute grants (15) =====
select is(has_function_privilege('anon','public.get_food_pack_signatures(uuid,uuid)','EXECUTE'), false, 'anon no execute on read RPC');
select is(has_function_privilege('authenticated','public.get_food_pack_signatures(uuid,uuid)','EXECUTE'), true, 'authenticated execute read RPC');
select is(has_function_privilege('service_role','public.get_food_pack_signatures(uuid,uuid)','EXECUTE'), true, 'service_role execute read RPC');
select is(has_function_privilege('anon','public.set_food_pack_state(uuid,uuid,uuid,boolean,text)','EXECUTE'), false, 'anon no execute on write RPC');
select is(has_function_privilege('authenticated','public.set_food_pack_state(uuid,uuid,uuid,boolean,text)','EXECUTE'), true, 'authenticated execute write RPC');
select is(has_function_privilege('service_role','public.set_food_pack_state(uuid,uuid,uuid,boolean,text)','EXECUTE'), true, 'service_role execute write RPC');
select is(has_function_privilege('anon','public.food_pack_signature(numeric,numeric)','EXECUTE'), false, 'anon no execute on signature helper');
select is(has_function_privilege('authenticated','public.food_pack_signature(numeric,numeric)','EXECUTE'), true, 'authenticated execute signature helper');
select is(has_function_privilege('service_role','public.food_pack_signature(numeric,numeric)','EXECUTE'), true, 'service_role execute signature helper');
select is(has_function_privilege('anon','public.food_pack_lock_key(uuid)','EXECUTE'), false, 'anon no execute on lock-key helper');
select is(has_function_privilege('authenticated','public.food_pack_lock_key(uuid)','EXECUTE'), true, 'authenticated execute lock-key helper');
select is(has_function_privilege('service_role','public.food_pack_lock_key(uuid)','EXECUTE'), true, 'service_role execute lock-key helper');
select is(has_function_privilege('anon','public.cleanup_food_pack_state_on_entry_delete()','EXECUTE'), false, 'anon no execute on cleanup trigger fn');
select is(has_function_privilege('authenticated','public.cleanup_food_pack_state_on_entry_delete()','EXECUTE'), false, 'authenticated no execute on cleanup trigger fn');
select is(has_function_privilege('service_role','public.cleanup_food_pack_state_on_entry_delete()','EXECUTE'), false, 'service_role no execute on cleanup trigger fn');

-- ===== Step 4: signature determinism + reset matrix (5) =====
select is(public.food_pack_signature(300.000, 50.0), '300|50', 'trim_scale canonicalizes');
select set_eq(
  $$ select food_item_id::text, current_signature
       from public.get_food_pack_signatures('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1') $$,
  $$ values ('d0000000-0000-0000-0000-0000000000a3','300|50'),
            ('d0000000-0000-0000-0000-0000000000a4','100|40') $$,
  'baseline signatures match hand-computed grams');
update public.food_items set serving_weight_grams = 60 where id = 'd0000000-0000-0000-0000-0000000000a3';
select is((select current_signature from public.get_food_pack_signatures('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1')
           where food_item_id='d0000000-0000-0000-0000-0000000000a3'), '360|60', 'serving_weight_grams edit resets');
update public.food_items set serving_weight_grams = 50 where id = 'd0000000-0000-0000-0000-0000000000a3';
update public.food_items set servings_per_package = 6 where id = 'd0000000-0000-0000-0000-0000000000a3';
select is((select current_signature from public.get_food_pack_signatures('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1')
           where food_item_id='d0000000-0000-0000-0000-0000000000a3'), '400|50', 'servings_per_package edit resets');
update public.food_items set servings_per_package = 4 where id = 'd0000000-0000-0000-0000-0000000000a3';
update public.food_items set calories_per_serving = 999 where id = 'd0000000-0000-0000-0000-0000000000a3';
select is((select current_signature from public.get_food_pack_signatures('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1')
           where food_item_id='d0000000-0000-0000-0000-0000000000a3'), '300|50', 'nutrition-only edit does not reset');
update public.food_items set calories_per_serving = 190 where id = 'd0000000-0000-0000-0000-0000000000a3';

-- ===== Step 5: pack happy / mismatch / null-expected / rollback / unpack / not-in-plan / no-plan (9) =====
select lives_ok(
  $$ select public.set_food_pack_state('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a4', true, '100|40') $$,
  'pack Bar (expected matches)');
select is((select packed_signature from public.food_pack_state where food_item_id='d0000000-0000-0000-0000-0000000000a4'),
          '100|40', 'pack stores current signature');
select throws_ok(
  $$ select public.set_food_pack_state('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a4', true, '999|99') $$,
  'PT409', NULL, 'stale expected signature rejected');
select throws_ok(
  $$ select public.set_food_pack_state('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a4', true, null) $$,
  'PT409', NULL, 'packing requires a non-null expected signature');
select is(
  (select packed_signature from public.food_pack_state
   where food_item_id='d0000000-0000-0000-0000-0000000000a4' and is_packed),
  '100|40', 'Bar remains packed at 100|40 after both PT409 rejections');
select lives_ok(
  $$ select public.set_food_pack_state('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a4', false, null) $$,
  'unpack Bar');
select is((select packed_signature from public.food_pack_state where food_item_id='d0000000-0000-0000-0000-0000000000a4'),
          '', 'unpack clears signature');
select throws_ok(
  $$ select public.set_food_pack_state('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000ff', true, null) $$,
  '23503', NULL, 'cannot pack a food absent from the plan');
insert into public.lists (id, user_id, name, slug, sort_order)
  values ('c0000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000aa','NoPlan','noplan', 1);
select throws_ok(
  $$ select public.set_food_pack_state('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000c1','d0000000-0000-0000-0000-0000000000a3', true, null) $$,
  'P0002', NULL, 'no owned plan for list -> P0002');

-- ===== Step 6: merge keeps packing; direct + cascade removal reset (7) =====
select lives_ok(
  $$ select public.set_food_pack_state('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a3', true, '300|50') $$,
  'pack Oats');
delete from public.food_plan_entries where food_item_id='d0000000-0000-0000-0000-0000000000a3' and basis='packages';
update public.food_plan_entries set amount = 6 where food_item_id='d0000000-0000-0000-0000-0000000000a3' and basis='servings';
select is((select current_signature from public.get_food_pack_signatures('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1')
           where food_item_id='d0000000-0000-0000-0000-0000000000a3'), '300|50', 'merge preserving total leaves signature unchanged');
select is((select packed_signature from public.food_pack_state where food_item_id='d0000000-0000-0000-0000-0000000000a3'),
          '300|50', 'Oats still packed after a merge that preserves the total');
delete from public.food_plan_entries where food_item_id='d0000000-0000-0000-0000-0000000000a3';
select is((select count(*)::int from public.food_pack_state where food_item_id='d0000000-0000-0000-0000-0000000000a3'),
          0, 'pack state removed when last entry deleted');
insert into public.food_plan_entries (user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order)
  values ('00000000-0000-0000-0000-0000000000aa','e0000000-0000-0000-0000-0000000000a2','33330000-0000-0000-0000-0000000000a7', false, 'd0000000-0000-0000-0000-0000000000a3', 'servings', 6, 0);
select is((select count(*)::int from public.food_pack_state where food_item_id='d0000000-0000-0000-0000-0000000000a3'),
          0, 're-added food is unpacked (no stale pack row)');
-- day/meal cascade deletion also cleans up: fresh Gel + day so the main fixture is undisturbed.
insert into public.food_items (id, user_id, name, serving_weight_grams, calories_per_serving)
  values ('d0000000-0000-0000-0000-0000000000a8','00000000-0000-0000-0000-0000000000aa','Gel',10,100);
insert into public.food_plan_days (id, user_id, food_plan_id, sort_order)
  values ('22220000-0000-0000-0000-0000000000a9','00000000-0000-0000-0000-0000000000aa','e0000000-0000-0000-0000-0000000000a2',1);
insert into public.day_meals (id, user_id, food_plan_id, day_id, meal_id)
  values ('33330000-0000-0000-0000-0000000000ab','00000000-0000-0000-0000-0000000000aa','e0000000-0000-0000-0000-0000000000a2',
          '22220000-0000-0000-0000-0000000000a9','11110000-0000-0000-0000-0000000000a6');
insert into public.food_plan_entries (user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order)
  values ('00000000-0000-0000-0000-0000000000aa','e0000000-0000-0000-0000-0000000000a2','33330000-0000-0000-0000-0000000000ab', false, 'd0000000-0000-0000-0000-0000000000a8', 'weight', 50, 0);
select lives_ok(
  $$ select public.set_food_pack_state('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a8', true, '50|10') $$,
  'pack Gel');
delete from public.food_plan_days where id = '22220000-0000-0000-0000-0000000000a9';
select is((select count(*)::int from public.food_pack_state where food_item_id='d0000000-0000-0000-0000-0000000000a8'),
          0, 'day cascade deletion cleans up pack state');

-- ===== Step 7: incomplete metadata - NULL signature, packing rejected (2) =====
insert into public.food_plan_entries (user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order)
  values ('00000000-0000-0000-0000-0000000000aa','e0000000-0000-0000-0000-0000000000a2', null, true, 'd0000000-0000-0000-0000-0000000000a3', 'packages', 1, 2);
update public.food_items set servings_per_package = null where id = 'd0000000-0000-0000-0000-0000000000a3';
select is((select current_signature from public.get_food_pack_signatures('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1')
           where food_item_id='d0000000-0000-0000-0000-0000000000a3'), null,
          'incomplete metadata yields NULL signature, not a partial');
select throws_ok(
  $$ select public.set_food_pack_state('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a3', true, null) $$,
  '22023', NULL, 'cannot pack a food with incomplete packaging metadata');
update public.food_items set servings_per_package = 4 where id = 'd0000000-0000-0000-0000-0000000000a3';

-- ===== Step 8: cross-tenant isolation (7) =====
select lives_ok(
  $$ select public.set_food_pack_state('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a4', true, '100|40') $$,
  'A re-packs Bar for the isolation block');

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}';

select is((select count(*)::int from public.get_food_pack_signatures('00000000-0000-0000-0000-0000000000bb','c0000000-0000-0000-0000-0000000000a1')),
          0, 'user B reads no signatures for A list');
select throws_ok(
  $$ select * from public.get_food_pack_signatures('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1') $$,
  '42501', NULL, 'read RPC rejects a mismatched p_user_id');
select throws_ok(
  $$ select public.set_food_pack_state('00000000-0000-0000-0000-0000000000aa','c0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a4', false, null) $$,
  '42501', NULL, 'user B cannot pack as user A');
select throws_ok(
  $$ insert into public.food_pack_state (user_id, food_plan_id, food_item_id, is_packed, packed_signature)
     values ('00000000-0000-0000-0000-0000000000aa','e0000000-0000-0000-0000-0000000000a2','d0000000-0000-0000-0000-0000000000a4', false, '') $$,
  '42501', NULL, 'user B cannot insert a row owned by A');
with u as (update public.food_pack_state set packed_signature = packed_signature where user_id='00000000-0000-0000-0000-0000000000aa' returning 1),
     d as (delete from public.food_pack_state where user_id='00000000-0000-0000-0000-0000000000aa' returning 1)
select is((select count(*) from u) + (select count(*) from d), 0::bigint,
          'user B update/delete of A rows affect zero rows');

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}';
select is((select packed_signature from public.food_pack_state
           where user_id='00000000-0000-0000-0000-0000000000aa' and food_item_id='d0000000-0000-0000-0000-0000000000a4'),
          '100|40', 'A pack row survives B''s isolation attempts');

select * from finish();
rollback;
