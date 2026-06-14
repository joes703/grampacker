-- supabase/tests/target_defaults.test.sql
-- Idiom matches save_food_plan_targets.test.sql: insert ONLY auth.users (a
-- trigger backfills public.profiles); assume the authenticated role + per-user
-- jwt claims via `set local`; insert owned rows AFTER the role switch so RLS
-- WITH CHECK passes. Hex-only UUIDs. list.slug must be EXACTLY 6 chars
-- (lists_slug_length CHECK, migration 20260504000000). 4-arg throws_ok asserts a
-- SQLSTATE. Data-modifying statements under test use a TOP-LEVEL WITH ... RETURNING
-- so the row count is assertable (project_pgtap_data_modifying_cte rule).
begin;
select plan(33);
create extension if not exists pgtap with schema extensions;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'tgtdef1@test.dev'),
  ('00000000-0000-0000-0000-0000000000d2', 'tgtdef2@test.dev')
on conflict (id) do nothing;

-- == [1-6] Structural: table, RLS, full grant matrix (role-independent) ==
select has_table('public','food_plan_target_defaults','defaults table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.food_plan_target_defaults'::regclass),
  'RLS enabled on food_plan_target_defaults');
select ok(
  has_table_privilege('authenticated','public.food_plan_target_defaults','SELECT')
  and has_table_privilege('authenticated','public.food_plan_target_defaults','INSERT')
  and has_table_privilege('authenticated','public.food_plan_target_defaults','UPDATE')
  and has_table_privilege('authenticated','public.food_plan_target_defaults','DELETE'),
  'authenticated has full CRUD on defaults');
select ok(
  not has_table_privilege('anon','public.food_plan_target_defaults','SELECT')
  and not has_table_privilege('anon','public.food_plan_target_defaults','INSERT')
  and not has_table_privilege('anon','public.food_plan_target_defaults','UPDATE')
  and not has_table_privilege('anon','public.food_plan_target_defaults','DELETE'),
  'anon has NO table privileges on defaults');
select ok(
  has_function_privilege('authenticated','public.save_target_defaults(uuid, jsonb, jsonb)','EXECUTE'),
  'authenticated can execute save_target_defaults');
select ok(
  not has_function_privilege('anon','public.save_target_defaults(uuid, jsonb, jsonb)','EXECUTE'),
  'anon cannot execute save_target_defaults');

-- == Act as user 1; seed three lists (one per create_food_plan under test) ==
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

insert into public.lists (id, user_id, name, slug, sort_order) values
  ('51100000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','Trip','tgtdf1',0),
  ('51100000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000d1','Trip2','tgtdf2',1),
  ('51100000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000d1','Trip3','tgtdf3',2);

-- == [7-8] CHECK constraints ==
select throws_ok($$
  insert into public.food_plan_target_defaults (user_id, metric, mode, target_min, target_max)
  values ('00000000-0000-0000-0000-0000000000d1','protein','min',100,50)
$$, '23514', NULL, 'bounds CHECK rejects a contradictory min row');
-- I5: a stored 'off' row is impossible even via a direct insert.
select throws_ok($$
  insert into public.food_plan_target_defaults (user_id, metric, mode)
  values ('00000000-0000-0000-0000-0000000000d1','protein','off')
$$, '23514', NULL, 'mode CHECK forbids a stored off row (off = absent)');

-- == [9] save_target_defaults rejects a non-array payload -> 22023 ==
select throws_ok($$
  select public.save_target_defaults('00000000-0000-0000-0000-0000000000d1', '{}'::jsonb, '[]'::jsonb)
$$, '22023', NULL, 'non-array upserts payload rejected');

-- == [10-14] save_target_defaults: upsert two, then update one + delete one ==
select lives_ok($$
  select public.save_target_defaults(
    '00000000-0000-0000-0000-0000000000d1',
    '[{"metric":"calories","mode":"max","target_min":null,"target_max":2500},
      {"metric":"calorie_density","mode":"min","target_min":4.5,"target_max":null}]'::jsonb,
    '[]'::jsonb)
$$, 'save_target_defaults upserts two metrics');
select is((select count(*)::int from public.food_plan_target_defaults
            where user_id='00000000-0000-0000-0000-0000000000d1'),
          2, 'two default rows stored');
select lives_ok($$
  select public.save_target_defaults(
    '00000000-0000-0000-0000-0000000000d1',
    '[{"metric":"calories","mode":"range","target_min":2000,"target_max":2600}]'::jsonb,
    '["calorie_density"]'::jsonb)
$$, 'save_target_defaults updates one and deletes another');
select is((select mode from public.food_plan_target_defaults
            where user_id='00000000-0000-0000-0000-0000000000d1' and metric='calories'),
          'range', 'calories default updated to range');
select is((select count(*)::int from public.food_plan_target_defaults
            where user_id='00000000-0000-0000-0000-0000000000d1' and metric='calorie_density'),
          0, 'calorie_density default deleted');

-- == [15-16] Atomic save: a malformed 2nd row rolls back the valid 1st row ==
-- (fiber/sodium are unset here, so a post-test count of 0 proves the rollback.)
select throws_ok($$
  select public.save_target_defaults(
    '00000000-0000-0000-0000-0000000000d1',
    '[{"metric":"fiber","mode":"min","target_min":30,"target_max":null},
      {"metric":"sodium","mode":"range","target_min":900,"target_max":500}]'::jsonb,
    '[]'::jsonb)
$$, '23514', NULL, 'a malformed row aborts the whole save');
select is((select count(*)::int from public.food_plan_target_defaults
            where user_id='00000000-0000-0000-0000-0000000000d1' and metric in ('fiber','sodium')),
          0, 'neither row from the failed save persisted (atomic rollback)');

-- == [17-18] Contradictory payload (22023) and cross-tenant guard (42501) ==
select throws_ok($$
  select public.save_target_defaults(
    '00000000-0000-0000-0000-0000000000d1',
    '[{"metric":"calories","mode":"max","target_min":null,"target_max":2500}]'::jsonb,
    '["calories"]'::jsonb)
$$, '22023', NULL, 'contradictory default payload rejected');
select throws_ok($$
  select public.save_target_defaults(
    '00000000-0000-0000-0000-0000000000d2', '[]'::jsonb, '[]'::jsonb)
$$, '42501', NULL, 'save_target_defaults rejects a mismatched p_user_id');

-- == [19-22] Direct RLS cross-tenant ISOLATION ==
-- As user 2, store a default (fiber). User 1 must not see, update, or delete it.
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
insert into public.food_plan_target_defaults (user_id, metric, mode, target_min)
  values ('00000000-0000-0000-0000-0000000000d2','fiber','min',30);
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
-- User 1 has no fiber row of its own, so a visible count of 0 means RLS hid d2's.
select is((select count(*)::int from public.food_plan_target_defaults where metric='fiber'),
          0, 'user 1 cannot see user 2 fiber default (RLS read isolation)');
-- The data-modifying WITH must be the TOP-LEVEL statement feeding is(); nesting it
-- inside a scalar sub-select (select is((with ... ), ...)) is a Postgres error that
-- aborts the suite (project_pgtap_data_modifying_cte rule).
with u as (update public.food_plan_target_defaults set target_min = 999 where metric='fiber' returning 1)
  select is((select count(*)::int from u), 0, 'user 1 update cannot reach user 2 fiber default (0 rows)');
with d as (delete from public.food_plan_target_defaults where metric='fiber' returning 1)
  select is((select count(*)::int from d), 0, 'user 1 delete cannot reach user 2 fiber default (0 rows)');
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select is((select target_min::int from public.food_plan_target_defaults
            where user_id='00000000-0000-0000-0000-0000000000d2' and metric='fiber'),
          30, 'user 2 fiber default unchanged after user 1 attempts');
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

-- == [23-26] create_food_plan copies the OWNER's defaults only ==
-- User 1 defaults now: calories(range). Add protein(min); user 2 separately owns
-- fiber. The new plan (list 1) must receive exactly user 1's two, never user 2's.
select lives_ok($$
  select public.save_target_defaults(
    '00000000-0000-0000-0000-0000000000d1',
    '[{"metric":"protein","mode":"min","target_min":120,"target_max":null}]'::jsonb,
    '[]'::jsonb)
$$, 'add a protein default for user 1');
select lives_ok($$
  select public.create_food_plan(
    '00000000-0000-0000-0000-0000000000d1','51100000-0000-0000-0000-000000000001',
    '[{"id":"a1110000-0000-0000-0000-000000000001","name":"Breakfast","anchor_role":"breakfast","is_default":true,"sort_order":0}]'::jsonb,
    '[{"id":"a1120000-0000-0000-0000-000000000001","sort_order":0}]'::jsonb,
    '[{"id":"a1130000-0000-0000-0000-000000000001","day_id":"a1120000-0000-0000-0000-000000000001","meal_id":"a1110000-0000-0000-0000-000000000001"}]'::jsonb)
$$, 'create_food_plan with defaults present');
select is(
  (select count(*)::int from public.food_plan_daily_targets t
     join public.food_plans p on p.id = t.food_plan_id
    where p.list_id='51100000-0000-0000-0000-000000000001'),
  2, 'exactly user 1 two active defaults copied (user 2 fiber NOT copied; owner-scoped)');
select is(
  (select count(*)::int from public.food_plan_daily_targets t
     join public.food_plans p on p.id = t.food_plan_id
    where p.list_id='51100000-0000-0000-0000-000000000001' and t.metric='fiber'),
  0, 'no fiber target leaked from user 2 into user 1 plan');

-- == [27-29] Atomicity: a failure AFTER the plan insert rolls back EVERYTHING ==
-- A fresh list (no existing plan) with two Meals sharing one id makes the meals
-- INSERT fail (meals_pkey, 23505) AFTER food_plans is inserted. The whole
-- function must roll back: no plan row, no Meals. (The copy never runs - it is
-- after the meals insert - so this is the strongest constructible all-or-nothing
-- proof; see the migration comment on why a copy-specific post-failure cannot
-- exist.) 'AtomMeal' is a distinct name so the count is not polluted by list 1's
-- 'Breakfast' Meal.
select throws_ok($$
  select public.create_food_plan(
    '00000000-0000-0000-0000-0000000000d1','51100000-0000-0000-0000-000000000002',
    '[{"id":"a2110000-0000-0000-0000-000000000001","name":"AtomMeal","anchor_role":null,"is_default":true,"sort_order":0},
      {"id":"a2110000-0000-0000-0000-000000000001","name":"AtomMeal","anchor_role":null,"is_default":true,"sort_order":1}]'::jsonb,
    '[{"id":"a2120000-0000-0000-0000-000000000001","sort_order":0}]'::jsonb,
    '[{"id":"a2130000-0000-0000-0000-000000000001","day_id":"a2120000-0000-0000-0000-000000000001","meal_id":"a2110000-0000-0000-0000-000000000001"}]'::jsonb)
$$, '23505', NULL, 'a duplicate Meal id fails the create after the plan insert');
select is((select count(*)::int from public.food_plans where list_id='51100000-0000-0000-0000-000000000002'),
          0, 'no plan row remains after the failed create (rolled back)');
select is((select count(*)::int from public.meals where name='AtomMeal'),
          0, 'no Meals remain after the failed create (rolled back)');

-- == [30-31] I1: editing defaults AFTER creation does not rewrite the plan ==
select lives_ok($$
  select public.save_target_defaults(
    '00000000-0000-0000-0000-0000000000d1', '[]'::jsonb, '["protein","calories"]'::jsonb)
$$, 'clear all user 1 defaults after the plan exists');
select is(
  (select count(*)::int from public.food_plan_daily_targets t
     join public.food_plans p on p.id = t.food_plan_id
    where p.list_id='51100000-0000-0000-0000-000000000001'),
  2, 'plan keeps its copied targets after defaults are cleared (plan owns its copy)');

-- == [32-33] No defaults -> create succeeds and copies ZERO targets ==
-- User 1 now has no defaults (just cleared). Creating on a fresh list must work
-- and produce no daily targets.
select lives_ok($$
  select public.create_food_plan(
    '00000000-0000-0000-0000-0000000000d1','51100000-0000-0000-0000-000000000003',
    '[{"id":"a3110000-0000-0000-0000-000000000001","name":"Breakfast","anchor_role":"breakfast","is_default":true,"sort_order":0}]'::jsonb,
    '[{"id":"a3120000-0000-0000-0000-000000000001","sort_order":0}]'::jsonb,
    '[{"id":"a3130000-0000-0000-0000-000000000001","day_id":"a3120000-0000-0000-0000-000000000001","meal_id":"a3110000-0000-0000-0000-000000000001"}]'::jsonb)
$$, 'create_food_plan with no defaults succeeds');
select is(
  (select count(*)::int from public.food_plan_daily_targets t
     join public.food_plans p on p.id = t.food_plan_id
    where p.list_id='51100000-0000-0000-0000-000000000003'),
  0, 'a no-defaults create copies zero targets');

select * from finish();
rollback;
