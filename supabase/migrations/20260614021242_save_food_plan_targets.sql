-- Phase 3B-ii: atomic save of plan-owned targets. One transaction: ownership +
-- per-Meal relationship are validated, then daily/meal upserts and deletes apply
-- all-or-nothing. SECURITY INVOKER + RLS authorize the writes; the table CHECKs
-- enforce bounds, so a malformed row aborts the WHOLE batch (no partial save).
create function public.save_food_plan_targets(
  p_user_id uuid,
  p_food_plan_id uuid,
  p_daily_upserts jsonb,
  p_daily_deletes jsonb,
  p_meal_upserts jsonb,
  p_meal_deletes jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_meal_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.food_plans where id = p_food_plan_id and user_id = p_user_id) then
    raise exception 'food plan not owned' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_daily_upserts, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_daily_deletes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_meal_upserts, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_meal_deletes, '[]'::jsonb)) <> 'array' then
    raise exception 'target payloads must be arrays' using errcode = '22023';
  end if;

  -- The function is a trust boundary: do NOT let a contradictory payload silently
  -- resolve to last-write/delete-wins. Reject duplicate operations on the same
  -- target and any target that appears in BOTH the upsert and delete arrays.
  if (select count(*) <> count(distinct value->>'metric')
        from jsonb_array_elements(coalesce(p_daily_upserts, '[]'::jsonb)))
     or (select count(*) <> count(distinct value)
        from jsonb_array_elements_text(coalesce(p_daily_deletes, '[]'::jsonb)))
     or exists (
        select 1 from jsonb_array_elements(coalesce(p_daily_upserts, '[]'::jsonb)) u
        where u.value->>'metric' in (select value from jsonb_array_elements_text(coalesce(p_daily_deletes, '[]'::jsonb)))) then
    raise exception 'contradictory daily target payload' using errcode = '22023';
  end if;
  if (select count(*) <> count(distinct (value->>'meal_id', value->>'metric'))
        from jsonb_array_elements(coalesce(p_meal_upserts, '[]'::jsonb)))
     or (select count(*) <> count(distinct (value->>'meal_id', value->>'metric'))
        from jsonb_array_elements(coalesce(p_meal_deletes, '[]'::jsonb)))
     or exists (
        select 1 from jsonb_array_elements(coalesce(p_meal_upserts, '[]'::jsonb)) u
        join jsonb_array_elements(coalesce(p_meal_deletes, '[]'::jsonb)) d
          on u.value->>'meal_id' = d.value->>'meal_id' and u.value->>'metric' = d.value->>'metric') then
    raise exception 'contradictory meal target payload' using errcode = '22023';
  end if;

  -- Validate every Meal referenced by EITHER meal array (upserts AND deletes)
  -- belongs to this plan, before any write. A delete for a foreign/stale Meal id
  -- must be a hard error (23503), not a silent no-op that the scoped DELETE would
  -- otherwise swallow.
  if exists (
    select 1 from (
      select value->>'meal_id' as meal_id from jsonb_array_elements(coalesce(p_meal_upserts, '[]'::jsonb))
      union
      select value->>'meal_id' from jsonb_array_elements(coalesce(p_meal_deletes, '[]'::jsonb))
    ) ids
    where not exists (
      select 1 from public.meals m
      where m.id = ids.meal_id::uuid and m.food_plan_id = p_food_plan_id and m.user_id = p_user_id
    )
  ) then
    raise exception 'meal not in plan' using errcode = '23503';
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_daily_upserts, '[]'::jsonb)) loop
    insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode, target_min, target_max)
    values (p_user_id, p_food_plan_id, v_row->>'metric', v_row->>'mode',
            (v_row->>'target_min')::numeric, (v_row->>'target_max')::numeric)
    on conflict (food_plan_id, metric) do update
      set mode = excluded.mode, target_min = excluded.target_min, target_max = excluded.target_max;
  end loop;

  if jsonb_array_length(coalesce(p_daily_deletes, '[]'::jsonb)) > 0 then
    delete from public.food_plan_daily_targets
    where food_plan_id = p_food_plan_id
      and metric in (select jsonb_array_elements_text(p_daily_deletes));
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_meal_upserts, '[]'::jsonb)) loop
    v_meal_id := (v_row->>'meal_id')::uuid; -- ownership already validated up front
    insert into public.meal_targets (user_id, food_plan_id, meal_id, metric, mode, target_min, target_max)
    values (p_user_id, p_food_plan_id, v_meal_id, v_row->>'metric', v_row->>'mode',
            (v_row->>'target_min')::numeric, (v_row->>'target_max')::numeric)
    on conflict (meal_id, metric) do update
      set mode = excluded.mode, target_min = excluded.target_min, target_max = excluded.target_max;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_meal_deletes, '[]'::jsonb)) loop
    delete from public.meal_targets
    where food_plan_id = p_food_plan_id
      and meal_id = (v_row->>'meal_id')::uuid
      and metric = v_row->>'metric';
  end loop;
end;
$$;

revoke execute on function public.save_food_plan_targets(uuid, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_food_plan_targets(uuid, uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;
