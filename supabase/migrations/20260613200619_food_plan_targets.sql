-- Phase 3B: plan-owned nutrition targets (design 1.7, 1.8). Owner-only at both
-- layers (RLS + grant matrix, NO anon). Mode/bounds invariants enforced in the
-- DB. No cap trigger: the per-metric unique constraints bound the row counts.

-- 1.7 Daily targets ---------------------------------------------------------
create table public.food_plan_daily_targets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  food_plan_id  uuid not null,
  metric        text not null check (metric in
                  ('calories','protein','carbs','fiber','sodium','calorie_density')),
  mode          text not null check (mode in ('range','min','max','off')),
  target_min    numeric(12,4),
  target_max    numeric(12,4),
  constraint daily_target_one_per_metric unique (food_plan_id, metric),
  constraint daily_target_food_plan_id_fkey
    foreign key (food_plan_id, user_id) references public.food_plans(id, user_id) on delete cascade,
  constraint daily_target_bounds check (
    (target_min is null or target_min >= 0)
    and (target_max is null or target_max >= 0)
    and (
         (mode = 'off'   and target_min is null     and target_max is null)
      or (mode = 'min'   and target_min is not null and target_max is null)
      or (mode = 'max'   and target_max is not null and target_min is null)
      or (mode = 'range' and target_min is not null and target_max is not null and target_min <= target_max)
    )
  )
);

-- 1.8 Per-Meal targets ------------------------------------------------------
create table public.meal_targets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  food_plan_id  uuid not null,
  meal_id       uuid not null,
  metric        text not null check (metric in
                  ('calories','protein','fat_pct','sugar_pct','carb_protein_ratio')),
  mode          text not null check (mode in ('range','min','max','off')),
  target_min    numeric(12,4),
  target_max    numeric(12,4),
  constraint meal_target_one_per_metric unique (meal_id, metric),
  constraint meal_target_food_plan_id_fkey
    foreign key (food_plan_id, user_id) references public.food_plans(id, user_id) on delete cascade,
  constraint meal_target_meal_id_fkey
    foreign key (meal_id, food_plan_id) references public.meals(id, food_plan_id) on delete cascade,
  constraint meal_target_bounds check (
    (target_min is null or target_min >= 0)
    and (target_max is null or target_max >= 0)
    and (
         (mode = 'off'   and target_min is null     and target_max is null)
      or (mode = 'min'   and target_min is not null and target_max is null)
      or (mode = 'max'   and target_max is not null and target_min is null)
      or (mode = 'range' and target_min is not null and target_max is not null and target_min <= target_max)
    )
  ),
  constraint meal_target_pct_ceiling check (
    metric not in ('fat_pct', 'sugar_pct')
    or ((target_min is null or target_min <= 100) and (target_max is null or target_max <= 100))
  )
);

-- Indexes (design convention + unindexed-FK advisor) ------------------------
-- Leading user_id backs the FK to profiles(id) (profile delete, takeout, user reads).
create index food_plan_daily_targets_user_idx on public.food_plan_daily_targets (user_id);
create index meal_targets_user_idx            on public.meal_targets (user_id);
-- meal_targets needs a food_plan_id-leading index to back meal_target_food_plan_id_fkey
-- and plan-scoped reads. (daily: unique (food_plan_id, metric) already covers its
-- food_plans FK + plan reads. meal: unique (meal_id, metric) covers the meals FK.)
create index meal_targets_plan_idx            on public.meal_targets (food_plan_id);

-- RLS: owner-only, one FOR ALL policy per table (design 7.1) ----------------
alter table public.food_plan_daily_targets enable row level security;
alter table public.meal_targets            enable row level security;

create policy food_plan_daily_targets_owner_all on public.food_plan_daily_targets
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy meal_targets_owner_all on public.meal_targets
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Grant matrix (design 6.2 / 7.2): authenticated + service_role CRUD; NO anon.
revoke all on table public.food_plan_daily_targets, public.meal_targets
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table
  public.food_plan_daily_targets, public.meal_targets to authenticated;
grant select, insert, update, delete on table
  public.food_plan_daily_targets, public.meal_targets to service_role;
