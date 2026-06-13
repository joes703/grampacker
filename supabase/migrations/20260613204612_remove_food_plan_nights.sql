-- Food plans are day-based. Nights had no effect on the schedule or nutrition
-- calculations, so remove the unused context field and the active RPC argument.
alter table public.food_plans drop column num_nights;

-- New client signature: days and their Meal schedule are fully represented by
-- p_days and p_day_meals.
create or replace function public.create_food_plan(
  p_user_id     uuid,
  p_list_id     uuid,
  p_meals       jsonb,
  p_days        jsonb,
  p_day_meals   jsonb
)
returns public.food_plans
language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.food_plans;
  v_meal_ids uuid[];
  v_day_ids  uuid[];
  v_bad uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.lists l where l.id = p_list_id and l.user_id = p_user_id) then
    raise exception 'list not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg((e->>'id')::uuid), '{}') into v_meal_ids
  from jsonb_array_elements(coalesce(p_meals, '[]'::jsonb)) e;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into v_day_ids
  from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) e;

  select (e->>'id')::uuid into v_bad
  from jsonb_array_elements(coalesce(p_day_meals, '[]'::jsonb)) e
  where not ((e->>'day_id')::uuid = any(v_day_ids))
     or not ((e->>'meal_id')::uuid = any(v_meal_ids))
  limit 1;
  if v_bad is not null then
    raise exception 'day_meal references an unknown day or meal' using errcode = 'P0002';
  end if;

  if (select count(*) from jsonb_array_elements(coalesce(p_day_meals, '[]'::jsonb)))
     <> (select count(distinct ((e->>'day_id'), (e->>'meal_id')))
         from jsonb_array_elements(coalesce(p_day_meals, '[]'::jsonb)) e) then
    raise exception 'schedule has duplicate cells' using errcode = '22023';
  end if;

  insert into public.food_plans (user_id, list_id)
  values (p_user_id, p_list_id)
  returning * into v_plan;

  insert into public.meals (id, user_id, food_plan_id, name, anchor_role, is_default, sort_order)
  select (e->>'id')::uuid, p_user_id, v_plan.id, e->>'name',
         nullif(e->>'anchor_role','')::text,
         coalesce((e->>'is_default')::boolean, false),
         (e->>'sort_order')::int
  from jsonb_array_elements(coalesce(p_meals, '[]'::jsonb)) e;

  insert into public.food_plan_days (id, user_id, food_plan_id, sort_order)
  select (e->>'id')::uuid, p_user_id, v_plan.id, (e->>'sort_order')::int
  from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) e;

  insert into public.day_meals (id, user_id, food_plan_id, day_id, meal_id)
  select (e->>'id')::uuid, p_user_id, v_plan.id,
         (e->>'day_id')::uuid, (e->>'meal_id')::uuid
  from jsonb_array_elements(coalesce(p_day_meals, '[]'::jsonb)) e;

  return v_plan;
end;
$$;

revoke execute on function public.create_food_plan(uuid, uuid, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.create_food_plan(uuid, uuid, jsonb, jsonb, jsonb)
  to authenticated;

-- Compatibility for already-loaded clients during rollout. The obsolete
-- p_num_nights value is intentionally ignored. Remove this overload after the
-- no-nights client has been deployed everywhere.
create or replace function public.create_food_plan(
  p_user_id     uuid,
  p_list_id     uuid,
  p_num_nights  integer,
  p_meals       jsonb,
  p_days        jsonb,
  p_day_meals   jsonb
)
returns public.food_plans
language sql security invoker set search_path = '' as $$
  select public.create_food_plan(
    p_user_id, p_list_id, p_meals, p_days, p_day_meals
  );
$$;

revoke execute on function public.create_food_plan(uuid, uuid, integer, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.create_food_plan(uuid, uuid, integer, jsonb, jsonb, jsonb)
  to authenticated;
