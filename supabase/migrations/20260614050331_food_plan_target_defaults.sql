-- Phase 3B-iii: user-scoped default daily targets, copied into new plans.
-- Mirrors food_plan_daily_targets (20260613200619) minus food_plan_id, with a
-- per-user unique on metric. Owner-only (RLS FOR ALL + grant matrix, NO anon).
-- Defaults are daily-only in v1 (meal-target defaults are out of scope: meals do
-- not exist at config time).
create table public.food_plan_target_defaults (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  metric        text not null check (metric in
                  ('calories','protein','carbs','fiber','sodium','calorie_density')),
  -- DB-ENFORCED "off = absent" (invariant I5). Unlike the per-plan target tables,
  -- a default row may ONLY be an active target. authenticated holds direct CRUD,
  -- so the constraint - not just the editor - must forbid stored 'off' rows; Off
  -- is purely an editor action that DELETES the row. So no 'off' in this CHECK.
  mode          text not null check (mode in ('range','min','max')),
  target_min    numeric(12,4),
  target_max    numeric(12,4),
  constraint default_target_one_per_metric unique (user_id, metric),
  constraint default_target_bounds check (
    (target_min is null or target_min >= 0)
    and (target_max is null or target_max >= 0)
    and (
         (mode = 'min'   and target_min is not null and target_max is null)
      or (mode = 'max'   and target_max is not null and target_min is null)
      or (mode = 'range' and target_min is not null and target_max is not null and target_min <= target_max)
    )
  )
);

-- No separate user_id index: unique (user_id, metric) is a btree LEADING with
-- user_id, so it already backs the profiles FK and every user-scoped read. (The
-- sibling food_plan_daily_targets needs its own user_idx only because its unique
-- leads with food_plan_id, not user_id.)

alter table public.food_plan_target_defaults enable row level security;

create policy food_plan_target_defaults_owner_all on public.food_plan_target_defaults
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.food_plan_target_defaults
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.food_plan_target_defaults to authenticated;
grant select, insert, update, delete on table public.food_plan_target_defaults to service_role;

-- save_target_defaults: atomic daily-only editor save. Mirrors save_food_plan_targets
-- (20260614021242) minus plan scoping and the meal arrays. SECURITY INVOKER + RLS
-- authorize; the table CHECK enforces bounds so a malformed row aborts the batch.
create function public.save_target_defaults(
  p_user_id  uuid,
  p_upserts  jsonb,
  p_deletes  jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_upserts, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_deletes, '[]'::jsonb)) <> 'array' then
    raise exception 'default payloads must be arrays' using errcode = '22023';
  end if;

  -- Trust boundary: reject duplicate metrics and any metric in BOTH arrays so a
  -- contradictory payload cannot silently resolve to last-write/delete-wins.
  if (select count(*) <> count(distinct value->>'metric')
        from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)))
     or (select count(*) <> count(distinct value)
        from jsonb_array_elements_text(coalesce(p_deletes, '[]'::jsonb)))
     or exists (
        select 1 from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) u
        where u.value->>'metric' in (select value from jsonb_array_elements_text(coalesce(p_deletes, '[]'::jsonb)))) then
    raise exception 'contradictory default target payload' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) loop
    insert into public.food_plan_target_defaults (user_id, metric, mode, target_min, target_max)
    values (p_user_id, v_row->>'metric', v_row->>'mode',
            (v_row->>'target_min')::numeric, (v_row->>'target_max')::numeric)
    on conflict (user_id, metric) do update
      set mode = excluded.mode, target_min = excluded.target_min, target_max = excluded.target_max;
  end loop;

  if jsonb_array_length(coalesce(p_deletes, '[]'::jsonb)) > 0 then
    delete from public.food_plan_target_defaults
    where user_id = p_user_id
      and metric in (select jsonb_array_elements_text(p_deletes));
  end if;
end;
$$;

revoke execute on function public.save_target_defaults(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_target_defaults(uuid, jsonb, jsonb) to authenticated;

-- Extend create_food_plan to copy the caller's ACTIVE daily defaults into the new
-- plan, inside the same transaction. Body reproduced verbatim from migration
-- 20260613204612 with ONLY the trailing INSERT ... SELECT added. The 6-arg compat
-- overload (unchanged) delegates here, so it inherits the copy.
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

  -- Phase 3B-iii: copy the owner's daily defaults into the new plan.
  -- Server-authoritative (reads stored defaults; no client target payload). A
  -- plain INSERT snapshot: no link back to defaults, so later default edits never
  -- rewrite this plan. Every default row is an active target (the table CHECK
  -- forbids 'off'), so no mode filter is needed. unique(user_id, metric) on
  -- defaults guarantees at most one row per metric, so no conflict against
  -- food_plan_daily_targets' per-plan unique. Scoped to p_user_id so another
  -- user's defaults can never leak in (auth.uid() = p_user_id already enforced).
  insert into public.food_plan_daily_targets (user_id, food_plan_id, metric, mode, target_min, target_max)
  select p_user_id, v_plan.id, d.metric, d.mode, d.target_min, d.target_max
  from public.food_plan_target_defaults d
  where d.user_id = p_user_id;

  return v_plan;
end;
$$;

revoke execute on function public.create_food_plan(uuid, uuid, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.create_food_plan(uuid, uuid, jsonb, jsonb, jsonb)
  to authenticated;
