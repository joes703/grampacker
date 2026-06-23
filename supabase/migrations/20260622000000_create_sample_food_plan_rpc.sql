-- First-party "Load sample plan" onboarding helper.
--
-- Creates the Claude Design "Wind River high route" sample Food plan into one of
-- the caller's own lists that does not already have a plan, in a single
-- transaction. This is NOT a general Food-plan CSV import: the dataset lives in
-- the app (src/lib/food/sample-plan.ts), which resolves it into a plan with
-- client-generated UUIDs and food dedup, then passes it here as p_payload.
--
-- Modeled on create_list_with_imported_items / copy_food_plan_to_list:
-- SECURITY INVOKER + inline auth.uid() check + RLS, search_path = '' (everything
-- schema-qualified). The function does NOT trust the payload: it re-checks
-- ownership, that the list has no plan, and that every entry's food_item_id is
-- either a new id minted in this payload OR an existing food the caller owns.
--
-- Atomicity prevents partial writes (a mid-insert failure rolls the whole plan
-- back). It does NOT serialize food dedup across concurrent calls; that matches
-- the pre-existing, accepted behavior of the CSV-import RPC. The function never
-- writes food_pack_state and leaves is_food_shared at the default false.
create or replace function public.create_sample_food_plan(
  p_user_id uuid,
  p_list_id uuid,
  p_payload jsonb
)
returns public.food_plans
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan public.food_plans;
  v_plan_id uuid;
  v_new_food_ids uuid[];
  v_bad uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.lists l
    where l.id = p_list_id and l.user_id = p_user_id
  ) then
    raise exception 'list not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.food_plans fp
    where fp.list_id = p_list_id and fp.user_id = p_user_id
  ) then
    raise exception 'list already has a food plan' using errcode = '22023';
  end if;

  -- Food ids minted in this payload (the new library rows to insert).
  select coalesce(array_agg((e->>'id')::uuid), '{}') into v_new_food_ids
  from jsonb_array_elements(coalesce(p_payload->'foods', '[]'::jsonb)) e;

  -- Every entry's food must be minted here OR an existing food the caller owns.
  select e.food_item_id into v_bad
  from jsonb_to_recordset(coalesce(p_payload->'entries', '[]'::jsonb)) as e(food_item_id uuid)
  where e.food_item_id is not null
    and not (e.food_item_id = any(v_new_food_ids))
    and not exists (
      select 1 from public.food_items fi
      where fi.id = e.food_item_id and fi.user_id = p_user_id
    )
  limit 1;
  if v_bad is not null then
    raise exception 'entry references unknown food item %', v_bad using errcode = 'P0002';
  end if;

  -- 1) New food library items (existing ones were deduped out client-side).
  insert into public.food_items (
    id, user_id, name, brand, serving_description, serving_weight_grams, calories_per_serving,
    servings_per_package, fat_grams, saturated_fat_grams, carbs_grams, fiber_grams, sugar_grams,
    protein_grams, sodium_mg, potassium_mg, notes, sort_order
  )
  select
    f.id, p_user_id, f.name, f.brand, f.serving_description, f.serving_weight_grams, f.calories_per_serving,
    f.servings_per_package, f.fat_grams, f.saturated_fat_grams, f.carbs_grams, f.fiber_grams, f.sugar_grams,
    f.protein_grams, f.sodium_mg, f.potassium_mg, f.notes, f.sort_order
  from jsonb_to_recordset(coalesce(p_payload->'foods', '[]'::jsonb)) as f(
    id uuid, name text, brand text, serving_description text, serving_weight_grams numeric,
    calories_per_serving numeric, servings_per_package numeric, fat_grams numeric, saturated_fat_grams numeric,
    carbs_grams numeric, fiber_grams numeric, sugar_grams numeric, protein_grams numeric,
    sodium_mg numeric, potassium_mg numeric, notes text, sort_order integer
  );

  -- 2) The plan (server-minted id; private; never shared).
  insert into public.food_plans (user_id, list_id, is_food_shared)
  values (p_user_id, p_list_id, false)
  returning * into v_plan;
  v_plan_id := v_plan.id;

  -- 3) Meals.
  insert into public.meals (id, user_id, food_plan_id, name, anchor_role, is_default, sort_order)
  select m.id, p_user_id, v_plan_id, m.name, m.anchor_role, m.is_default, m.sort_order
  from jsonb_to_recordset(coalesce(p_payload->'meals', '[]'::jsonb)) as m(
    id uuid, name text, anchor_role text, is_default boolean, sort_order integer
  );

  -- 4) Days.
  insert into public.food_plan_days (id, user_id, food_plan_id, day_type_override, sort_order)
  select d.id, p_user_id, v_plan_id, d.day_type_override, d.sort_order
  from jsonb_to_recordset(coalesce(p_payload->'days', '[]'::jsonb)) as d(
    id uuid, day_type_override text, sort_order integer
  );

  -- 5) Day/meal schedule grid.
  insert into public.day_meals (id, user_id, food_plan_id, day_id, meal_id)
  select dm.id, p_user_id, v_plan_id, dm.day_id, dm.meal_id
  from jsonb_to_recordset(coalesce(p_payload->'day_meals', '[]'::jsonb)) as dm(
    id uuid, day_id uuid, meal_id uuid
  );

  -- 6) Entries (day_meal_id null + is_extra true == Extras).
  insert into public.food_plan_entries (
    id, user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order
  )
  select e.id, p_user_id, v_plan_id, e.day_meal_id, e.is_extra, e.food_item_id, e.basis, e.amount, e.sort_order
  from jsonb_to_recordset(coalesce(p_payload->'entries', '[]'::jsonb)) as e(
    id uuid, day_meal_id uuid, is_extra boolean, food_item_id uuid, basis text, amount numeric, sort_order integer
  );

  -- 7) Daily targets.
  insert into public.food_plan_daily_targets (id, user_id, food_plan_id, metric, mode, target_min, target_max)
  select t.id, p_user_id, v_plan_id, t.metric, t.mode, t.target_min, t.target_max
  from jsonb_to_recordset(coalesce(p_payload->'daily_targets', '[]'::jsonb)) as t(
    id uuid, metric text, mode text, target_min numeric, target_max numeric
  );

  -- 8) Meal targets.
  insert into public.meal_targets (id, user_id, food_plan_id, meal_id, metric, mode, target_min, target_max)
  select t.id, p_user_id, v_plan_id, t.meal_id, t.metric, t.mode, t.target_min, t.target_max
  from jsonb_to_recordset(coalesce(p_payload->'meal_targets', '[]'::jsonb)) as t(
    id uuid, meal_id uuid, metric text, mode text, target_min numeric, target_max numeric
  );

  return v_plan;
end;
$$;

revoke execute on function public.create_sample_food_plan(uuid, uuid, jsonb) from public, anon;
grant  execute on function public.create_sample_food_plan(uuid, uuid, jsonb) to   authenticated;
