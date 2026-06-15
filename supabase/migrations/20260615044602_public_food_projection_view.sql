-- Phase 5B: aggregate Food projection on public Gear shares.
--
-- This is the always-visible derived food weight surface for /r/:slug.
-- It is NOT the detailed Food plan. Gated only by lists.is_shared, exposes
-- one aggregate row per distinct food, and never exposes days, Meals, entries,
-- nutrition targets, notes, user_id, timestamps, is_food_shared, or pack state.
--
-- Security shape matches the curated Gear public views:
--   - security_invoker=true to satisfy Supabase view advisors;
--   - anon receives column-level grants only for base columns needed by the view;
--   - authenticated private reads stay owner-only through base tables;
--   - browser public helpers use the sessionless anon client.

create or replace view public.food_projection_public
  with (security_barrier = true, security_invoker = true) as
select
  l.slug as list_slug,
  fi.name as food_name,
  fi.brand,
  sum(
    case e.basis
      when 'servings' then e.amount
      when 'packages' then e.amount * fi.servings_per_package
      when 'weight' then e.amount / fi.serving_weight_grams
    end
  ) as total_effective_servings,
  sum(
    case e.basis
      when 'servings' then e.amount * fi.serving_weight_grams
      when 'packages' then e.amount * fi.servings_per_package * fi.serving_weight_grams
      when 'weight' then e.amount
    end
  ) as total_weight_grams
from public.food_plan_entries e
join public.food_plans fp
  on fp.id = e.food_plan_id
join public.lists l
  on l.id = fp.list_id
join public.food_items fi
  on fi.id = e.food_item_id
where l.is_shared = true
group by l.slug, fi.id, fi.name, fi.brand
order by min(e.sort_order), fi.name;

revoke all privileges on table public.food_projection_public
  from public, anon, authenticated, service_role;
grant select on table public.food_projection_public to anon;
grant select on table public.food_projection_public to service_role;

-- Column-level anon grants needed by the security-invoker view. These are
-- reachability grants, not broad public table access. RLS still gates rows:
-- lists has anon public-share policies, while food base tables have no anon
-- policies except what can be reached through this view's join to a shared list.
grant select (id, slug, is_shared)
  on table public.lists to anon;
grant select (id, list_id)
  on table public.food_plans to anon;
grant select (food_plan_id, food_item_id, basis, amount, sort_order)
  on table public.food_plan_entries to anon;
grant select (id, name, brand, serving_weight_grams, servings_per_package)
  on table public.food_items to anon;

drop policy if exists food_plans_anon_shared_list_select on public.food_plans;
create policy food_plans_anon_shared_list_select on public.food_plans
  for select to anon
  using (
    exists (
      select 1
      from public.lists l
      where l.id = food_plans.list_id
        and l.is_shared = true
    )
  );

drop policy if exists food_plan_entries_anon_shared_list_select on public.food_plan_entries;
create policy food_plan_entries_anon_shared_list_select on public.food_plan_entries
  for select to anon
  using (
    exists (
      select 1
      from public.food_plans fp
      join public.lists l
        on l.id = fp.list_id
      where fp.id = food_plan_entries.food_plan_id
        and l.is_shared = true
    )
  );

drop policy if exists food_items_anon_shared_list_select on public.food_items;
create policy food_items_anon_shared_list_select on public.food_items
  for select to anon
  using (
    exists (
      select 1
      from public.food_plan_entries e
      join public.food_plans fp
        on fp.id = e.food_plan_id
      join public.lists l
        on l.id = fp.list_id
      where e.food_item_id = food_items.id
        and l.is_shared = true
    )
  );
