-- Phase 5C: detailed public Food-plan read surface.
--
-- Aggregate Food projection (food_projection_public) stays visible on any
-- shared Gear list. The detailed day-by-day Food plan is stricter: it is
-- exposed only when BOTH the parent Gear list is public and the plan's
-- is_food_shared toggle is on.
--
-- Security note:
-- The existing advisor-clean public Gear/Food aggregate pattern uses
-- security-invoker views plus column-level anon grants. That pattern is not
-- appropriate for detailed Food plans because entry/day/meal base columns would
-- become directly selectable by anon for aggregate-only shares. This RPC is a
-- narrow SECURITY DEFINER exception: it performs the public-gating predicate
-- internally, returns one JSON document with an explicit allowlist, sets an
-- empty search_path, and grants execute only to anon + service_role.

create or replace function public.get_public_food_plan(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_id uuid;
  v_doc jsonb;
begin
  select fp.id
    into v_plan_id
  from public.food_plans fp
  join public.lists l
    on l.id = fp.list_id
  where l.slug = p_slug
    and l.is_shared = true
    and fp.is_food_shared = true;

  if v_plan_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'plan', jsonb_build_object(
      'id', v_plan_id,
      'list_slug', p_slug
    ),
    'meals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'anchor_role', m.anchor_role,
        'is_default', m.is_default,
        'sort_order', m.sort_order
      ) order by m.sort_order, m.id)
      from public.meals m
      where m.food_plan_id = v_plan_id
    ), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'day_type_override', d.day_type_override,
        'sort_order', d.sort_order
      ) order by d.sort_order, d.id)
      from public.food_plan_days d
      where d.food_plan_id = v_plan_id
    ), '[]'::jsonb),
    'dayMeals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', dm.id,
        'day_id', dm.day_id,
        'meal_id', dm.meal_id
      ) order by dm.id)
      from public.day_meals dm
      where dm.food_plan_id = v_plan_id
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'day_meal_id', e.day_meal_id,
        'is_extra', e.is_extra,
        'food_item_id', e.food_item_id,
        'basis', e.basis,
        'amount', e.amount,
        'sort_order', e.sort_order
      ) order by e.is_extra, e.sort_order, e.id)
      from public.food_plan_entries e
      where e.food_plan_id = v_plan_id
    ), '[]'::jsonb),
    'foods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', fi.id,
        'name', fi.name,
        'brand', fi.brand,
        'serving_description', fi.serving_description,
        'serving_weight_grams', fi.serving_weight_grams,
        'calories_per_serving', fi.calories_per_serving,
        'servings_per_package', fi.servings_per_package,
        'fat_grams', fi.fat_grams,
        'saturated_fat_grams', fi.saturated_fat_grams,
        'carbs_grams', fi.carbs_grams,
        'fiber_grams', fi.fiber_grams,
        'sugar_grams', fi.sugar_grams,
        'protein_grams', fi.protein_grams,
        'sodium_mg', fi.sodium_mg,
        'potassium_mg', fi.potassium_mg,
        'sort_order', fi.sort_order
      ) order by fi.name, fi.id)
      from public.food_items fi
      where exists (
        select 1
        from public.food_plan_entries e
        where e.food_plan_id = v_plan_id
          and e.food_item_id = fi.id
      )
    ), '[]'::jsonb),
    'dailyTargets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'metric', t.metric,
        'mode', t.mode,
        'target_min', t.target_min,
        'target_max', t.target_max
      ) order by t.metric, t.id)
      from public.food_plan_daily_targets t
      where t.food_plan_id = v_plan_id
    ), '[]'::jsonb),
    'mealTargets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'meal_id', t.meal_id,
        'metric', t.metric,
        'mode', t.mode,
        'target_min', t.target_min,
        'target_max', t.target_max
      ) order by t.meal_id, t.metric, t.id)
      from public.meal_targets t
      where t.food_plan_id = v_plan_id
    ), '[]'::jsonb)
  ) into v_doc;

  return v_doc;
end;
$$;

revoke all on function public.get_public_food_plan(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_food_plan(text) to anon;
grant execute on function public.get_public_food_plan(text) to service_role;
