-- Owner-side Food plan copy.
--
-- Copies one of the caller's existing Food plans into one of their own lists that
-- does not already have a Food plan. This is an independent snapshot: it reuses
-- the same account-wide food_items, but mints new plan/schedule/entry/target ids,
-- does not copy food_pack_state, and leaves is_food_shared at the default false.

create or replace function public.copy_food_plan_to_list(
  p_user_id uuid,
  p_source_food_plan_id uuid,
  p_target_list_id uuid
)
returns public.food_plans
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan public.food_plans;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.food_plans fp
    where fp.id = p_source_food_plan_id
      and fp.user_id = p_user_id
  ) then
    raise exception 'source food plan not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.lists l
    where l.id = p_target_list_id
      and l.user_id = p_user_id
  ) then
    raise exception 'target list not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.food_plans fp
    where fp.list_id = p_target_list_id
      and fp.user_id = p_user_id
  ) then
    raise exception 'target list already has a food plan' using errcode = '22023';
  end if;

  with
  source_meals as (
    select *
    from public.meals
    where food_plan_id = p_source_food_plan_id
      and user_id = p_user_id
  ),
  meal_map as (
    select id as old_id, gen_random_uuid() as new_id
    from source_meals
  ),
  source_days as (
    select *
    from public.food_plan_days
    where food_plan_id = p_source_food_plan_id
      and user_id = p_user_id
  ),
  day_map as (
    select id as old_id, gen_random_uuid() as new_id
    from source_days
  ),
  new_plan as (
    insert into public.food_plans (user_id, list_id, is_food_shared)
    values (p_user_id, p_target_list_id, false)
    returning *
  ),
  ins_meals as (
    insert into public.meals (id, user_id, food_plan_id, name, anchor_role, is_default, sort_order)
    select mm.new_id, p_user_id, np.id, sm.name, sm.anchor_role, sm.is_default, sm.sort_order
    from meal_map mm
    join source_meals sm on sm.id = mm.old_id
    cross join new_plan np
    returning id
  ),
  ins_days as (
    insert into public.food_plan_days (id, user_id, food_plan_id, day_type_override, sort_order)
    select dm.new_id, p_user_id, np.id, sd.day_type_override, sd.sort_order
    from day_map dm
    join source_days sd on sd.id = dm.old_id
    cross join new_plan np
    returning id
  ),
  day_meal_map as (
    select sdm.id as old_id, gen_random_uuid() as new_id, dm.new_id as new_day_id, mm.new_id as new_meal_id
    from public.day_meals sdm
    join day_map dm on dm.old_id = sdm.day_id
    join meal_map mm on mm.old_id = sdm.meal_id
    where sdm.food_plan_id = p_source_food_plan_id
      and sdm.user_id = p_user_id
  ),
  ins_day_meals as (
    insert into public.day_meals (id, user_id, food_plan_id, day_id, meal_id)
    select dmm.new_id, p_user_id, np.id, dmm.new_day_id, dmm.new_meal_id
    from day_meal_map dmm
    cross join new_plan np
    returning id
  ),
  ins_entries as (
    insert into public.food_plan_entries
      (user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order)
    select p_user_id, np.id,
           case when e.is_extra then null else dmm.new_id end,
           e.is_extra, e.food_item_id, e.basis, e.amount, e.sort_order
    from public.food_plan_entries e
    cross join new_plan np
    left join day_meal_map dmm on dmm.old_id = e.day_meal_id
    where e.food_plan_id = p_source_food_plan_id
      and e.user_id = p_user_id
    returning id
  ),
  ins_daily_targets as (
    insert into public.food_plan_daily_targets
      (user_id, food_plan_id, metric, mode, target_min, target_max)
    select p_user_id, np.id, t.metric, t.mode, t.target_min, t.target_max
    from public.food_plan_daily_targets t
    cross join new_plan np
    where t.food_plan_id = p_source_food_plan_id
      and t.user_id = p_user_id
    returning id
  ),
  ins_meal_targets as (
    insert into public.meal_targets
      (user_id, food_plan_id, meal_id, metric, mode, target_min, target_max)
    select p_user_id, np.id, mm.new_id, t.metric, t.mode, t.target_min, t.target_max
    from public.meal_targets t
    join meal_map mm on mm.old_id = t.meal_id
    cross join new_plan np
    where t.food_plan_id = p_source_food_plan_id
      and t.user_id = p_user_id
    returning id
  )
  select np.*
    into v_plan
  from new_plan np
  cross join (select count(*) from ins_meals) _meals
  cross join (select count(*) from ins_days) _days
  cross join (select count(*) from ins_day_meals) _day_meals
  cross join (select count(*) from ins_entries) _entries
  cross join (select count(*) from ins_daily_targets) _daily_targets
  cross join (select count(*) from ins_meal_targets) _meal_targets;

  return v_plan;
end;
$$;

revoke all on function public.copy_food_plan_to_list(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.copy_food_plan_to_list(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.copy_food_plan_to_list(uuid, uuid, uuid)
  to service_role;
