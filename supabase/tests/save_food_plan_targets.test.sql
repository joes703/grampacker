begin;
select plan(17);
create extension if not exists pgtap with schema extensions;

-- NB: every UUID below is hex-only (0-9a-f). Do NOT use suffixes like s1/s2 -
-- they are not valid UUID characters and abort setup before any assertion runs.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'tgtsave1@test.dev'),
  ('00000000-0000-0000-0000-0000000000d2', 'tgtsave2@test.dev')
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

insert into public.lists (id, user_id, name, slug, sort_order) values
  ('51000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','Trip','svtsl1',0),
  ('51000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000d1','Trip2','svtsl2',1);
insert into public.food_plans (id, user_id, list_id) values
  ('e5000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','51000000-0000-0000-0000-000000000001'),
  ('e5000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000d1','51000000-0000-0000-0000-000000000002');
insert into public.meals (id, user_id, food_plan_id, name, sort_order) values
  ('15000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','e5000000-0000-0000-0000-000000000001','Breakfast',0),
  ('15000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000d1','e5000000-0000-0000-0000-000000000002','OtherPlanMeal',0);

-- Happy path: a daily + a meal target are created atomically.
select lives_ok($$
  select public.save_food_plan_targets(
    '00000000-0000-0000-0000-0000000000d1','e5000000-0000-0000-0000-000000000001',
    '[{"metric":"calories","mode":"range","target_min":2000,"target_max":3000}]'::jsonb,
    '[]'::jsonb,
    '[{"meal_id":"15000000-0000-0000-0000-000000000001","metric":"fat_pct","mode":"max","target_min":null,"target_max":30}]'::jsonb,
    '[]'::jsonb)
$$, 'owner saves a daily and a meal target');
select is((select count(*)::int from public.food_plan_daily_targets where food_plan_id='e5000000-0000-0000-0000-000000000001'),1,'one daily target written');
select is((select count(*)::int from public.meal_targets where food_plan_id='e5000000-0000-0000-0000-000000000001'),1,'one meal target written');

-- Update + delete in one call.
select lives_ok($$
  select public.save_food_plan_targets(
    '00000000-0000-0000-0000-0000000000d1','e5000000-0000-0000-0000-000000000001',
    '[{"metric":"protein","mode":"min","target_min":100,"target_max":null}]'::jsonb,
    '["calories"]'::jsonb, '[]'::jsonb, '[]'::jsonb)
$$, 'owner adds protein and deletes calories in one call');
select is((select mode from public.food_plan_daily_targets where food_plan_id='e5000000-0000-0000-0000-000000000001' and metric='protein'),'min','protein target persisted');
select is((select count(*)::int from public.food_plan_daily_targets where food_plan_id='e5000000-0000-0000-0000-000000000001' and metric='calories'),0,'calories target deleted');

-- ATOMIC ROLLBACK: a batch whose 2nd row is malformed (range min>max) writes NOTHING.
select throws_ok($$
  select public.save_food_plan_targets(
    '00000000-0000-0000-0000-0000000000d1','e5000000-0000-0000-0000-000000000001',
    '[{"metric":"fiber","mode":"min","target_min":30,"target_max":null},{"metric":"sodium","mode":"range","target_min":900,"target_max":500}]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
$$, '23514', NULL, 'a malformed bound aborts the batch');
select is((select count(*)::int from public.food_plan_daily_targets where food_plan_id='e5000000-0000-0000-0000-000000000001' and metric in ('fiber','sodium')),0,'neither row from the failed batch persisted (atomic)');

-- Relationship: a meal from a different plan is rejected in an UPSERT...
select throws_ok($$
  select public.save_food_plan_targets(
    '00000000-0000-0000-0000-0000000000d1','e5000000-0000-0000-0000-000000000001',
    '[]'::jsonb, '[]'::jsonb,
    '[{"meal_id":"15000000-0000-0000-0000-000000000002","metric":"calories","mode":"min","target_min":400,"target_max":null}]'::jsonb,
    '[]'::jsonb)
$$, '23503', NULL, 'a meal upsert for a meal in another plan is rejected');
-- ...AND in a DELETE (a foreign/stale meal id must be a hard error, not a no-op).
select throws_ok($$
  select public.save_food_plan_targets(
    '00000000-0000-0000-0000-0000000000d1','e5000000-0000-0000-0000-000000000001',
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '[{"meal_id":"15000000-0000-0000-0000-000000000002","metric":"calories"}]'::jsonb)
$$, '23503', NULL, 'a meal delete for a meal in another plan is rejected');

-- Contradictory payloads are rejected up front (no last-write/delete-wins).
select throws_ok($$
  select public.save_food_plan_targets(
    '00000000-0000-0000-0000-0000000000d1','e5000000-0000-0000-0000-000000000001',
    '[{"metric":"fiber","mode":"min","target_min":10,"target_max":null},{"metric":"fiber","mode":"max","target_min":null,"target_max":40}]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
$$, '22023', NULL, 'a duplicate daily upsert metric is rejected');
select throws_ok($$
  select public.save_food_plan_targets(
    '00000000-0000-0000-0000-0000000000d1','e5000000-0000-0000-0000-000000000001',
    '[{"metric":"fiber","mode":"min","target_min":10,"target_max":null}]'::jsonb,
    '["fiber"]'::jsonb, '[]'::jsonb, '[]'::jsonb)
$$, '22023', NULL, 'the same daily metric in both upsert and delete is rejected');
-- ...the same disjointness/uniqueness rules apply to the Meal arrays (meal 1 is in this plan).
select throws_ok($$
  select public.save_food_plan_targets(
    '00000000-0000-0000-0000-0000000000d1','e5000000-0000-0000-0000-000000000001',
    '[]'::jsonb, '[]'::jsonb,
    '[{"meal_id":"15000000-0000-0000-0000-000000000001","metric":"fat_pct","mode":"max","target_min":null,"target_max":20},{"meal_id":"15000000-0000-0000-0000-000000000001","metric":"fat_pct","mode":"max","target_min":null,"target_max":40}]'::jsonb,
    '[]'::jsonb)
$$, '22023', NULL, 'a duplicate (meal_id, metric) upsert is rejected');
select throws_ok($$
  select public.save_food_plan_targets(
    '00000000-0000-0000-0000-0000000000d1','e5000000-0000-0000-0000-000000000001',
    '[]'::jsonb, '[]'::jsonb,
    '[{"meal_id":"15000000-0000-0000-0000-000000000001","metric":"fat_pct","mode":"max","target_min":null,"target_max":20}]'::jsonb,
    '[{"meal_id":"15000000-0000-0000-0000-000000000001","metric":"fat_pct"}]'::jsonb)
$$, '22023', NULL, 'the same (meal_id, metric) in both meal upsert and delete is rejected');

-- Cross-tenant: s2 cannot save into s1 plan.
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select throws_ok($$
  select public.save_food_plan_targets(
    '00000000-0000-0000-0000-0000000000d2','e5000000-0000-0000-0000-000000000001',
    '[{"metric":"calories","mode":"min","target_min":1,"target_max":null}]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)
$$, '42501', NULL, 's2 cannot save targets into s1 plan');

-- Grant matrix: anon is denied, authenticated is allowed.
select ok(not has_function_privilege('anon', 'public.save_food_plan_targets(uuid,uuid,jsonb,jsonb,jsonb,jsonb)', 'execute'), 'anon cannot execute save_food_plan_targets');
select ok(has_function_privilege('authenticated', 'public.save_food_plan_targets(uuid,uuid,jsonb,jsonb,jsonb,jsonb)', 'execute'), 'authenticated can execute save_food_plan_targets');

select finish();
rollback;
