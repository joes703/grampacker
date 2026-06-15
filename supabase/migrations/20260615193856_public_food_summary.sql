-- Aggregate-only Food weight on public Gear shares.
--
-- Supersedes 20260615044602_public_food_projection_view.sql, which exposed
-- itemized food (names, brands, effective servings, per-food weight,
-- food_item_id) to ANY shared Gear list via the food_projection_public invoker
-- view plus anon column grants + RLS policies on the food base tables --
-- regardless of food_plans.is_food_shared. Public Gear shares are shakedowns:
-- they show total carried food WEIGHT only, never the menu. Itemized food stays
-- behind get_public_food_plan(slug), which is SECURITY DEFINER and dual-gated on
-- lists.is_shared AND food_plans.is_food_shared.
--
-- 1. drop the itemized view;
-- 2. remove every anon grant + RLS policy on the food base tables (anon ends
--    with zero direct read on food_items/food_plans/food_plan_entries);
-- 3. add food_projection_public_summary(slug) -> numeric total weight, SECURITY
--    DEFINER + search_path='' (bypasses RLS, self-gates on is_shared).

-- 1. Drop the itemized invoker view.
drop view if exists public.food_projection_public;

-- 2. Withdraw anon access to the food base tables. Revoke from PUBLIC too, so
-- no role-tree/PUBLIC path can grant effective access (Supabase does not grant
-- these tables to PUBLIC today, so this is a no-op that future-proofs the
-- boundary; it does not touch the explicit authenticated/service_role grants the
-- owner path relies on). Table-level REVOKE ALL does NOT remove column-level
-- grants in Postgres, so we also revoke the exact column grants the superseded
-- 20260615044602 migration created. lists anon grants stay: the curated
-- public_gear_* invoker views still need them. Only food is withdrawn.
revoke all privileges on table public.food_items from public, anon;
revoke all privileges on table public.food_plans from public, anon;
revoke all privileges on table public.food_plan_entries from public, anon;

revoke select (id, name, brand, serving_weight_grams, servings_per_package)
  on table public.food_items from anon;
revoke select (id, list_id)
  on table public.food_plans from anon;
revoke select (food_plan_id, food_item_id, basis, amount, sort_order)
  on table public.food_plan_entries from anon;

drop policy if exists food_items_anon_shared_list_select on public.food_items;
drop policy if exists food_plans_anon_shared_list_select on public.food_plans;
drop policy if exists food_plan_entries_anon_shared_list_select on public.food_plan_entries;

-- 3. Aggregate-weight-only summary. SECURITY DEFINER so it bypasses the (now
-- absent) anon RLS and reads owner rows; self-gated on l.is_shared, so a private
-- or unknown slug yields 0. Returns ONLY a scalar weight: no food name, brand,
-- serving count, calorie, or id can leave this surface. The weight sum has no
-- division (weight basis returns amount; servings/packages multiply), and
-- validate_food_plan_entry_basis guarantees servings_per_package is present and
-- positive for the packages basis, so there is no NULL/0 hazard. coalesce makes
-- "no food" and "not shared" both return 0.
create or replace function public.food_projection_public_summary(p_slug text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    case e.basis
      when 'servings' then e.amount * fi.serving_weight_grams
      when 'packages' then e.amount * fi.servings_per_package * fi.serving_weight_grams
      when 'weight' then e.amount
    end
  ), 0)::numeric
  from public.food_plan_entries e
  join public.food_plans fp on fp.id = e.food_plan_id
  join public.lists l on l.id = fp.list_id
  join public.food_items fi on fi.id = e.food_item_id
  where l.slug = p_slug
    and l.is_shared = true;
$$;

revoke all on function public.food_projection_public_summary(text)
  from public, anon, authenticated, service_role;
grant execute on function public.food_projection_public_summary(text) to anon;
grant execute on function public.food_projection_public_summary(text) to service_role;
