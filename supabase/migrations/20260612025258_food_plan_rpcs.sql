-- Food plan write RPCs. Security invoker + search_path = ''.
-- create_food_plan accepts an owner-chosen SUBSET grid. add_food_plan_day /
-- add_meal_definition / duplicate_food_plan_day are server-authoritative (no
-- client grid trusted). upsert_food_plan_entry is concurrency-safe (advisory
-- lock) and cap-safe (in-place relocate on an empty move target).

-- 8.1 create_food_plan: plan + seeded Meals + explicitly-entered days + an
-- owner-chosen schedule (any UNIQUE VALID SUBSET of days x meals; omissions OK).
create or replace function public.create_food_plan(
  p_user_id     uuid,
  p_list_id     uuid,
  p_num_nights  integer,
  p_meals       jsonb,   -- [{id, name, anchor_role|null, is_default, sort_order}]
  p_days        jsonb,   -- [{id, sort_order}]
  p_day_meals   jsonb    -- [{id, day_id, meal_id}]  any unique valid subset
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

  -- every scheduled cell references a minted day AND meal (no dangling refs)
  select (e->>'id')::uuid into v_bad
  from jsonb_array_elements(coalesce(p_day_meals, '[]'::jsonb)) e
  where not ((e->>'day_id')::uuid = any(v_day_ids)) or not ((e->>'meal_id')::uuid = any(v_meal_ids))
  limit 1;
  if v_bad is not null then
    raise exception 'day_meal references an unknown day or meal' using errcode = 'P0002';
  end if;
  -- no duplicate (day, meal) pairs (subset is otherwise free; omissions are intentional)
  if (select count(*) from jsonb_array_elements(coalesce(p_day_meals, '[]'::jsonb)))
     <> (select count(distinct ((e->>'day_id'), (e->>'meal_id')))
         from jsonb_array_elements(coalesce(p_day_meals, '[]'::jsonb)) e) then
    raise exception 'schedule has duplicate cells' using errcode = '22023';
  end if;

  insert into public.food_plans (user_id, list_id, num_nights)
  values (p_user_id, p_list_id, p_num_nights)
  returning * into v_plan;

  insert into public.meals (id, user_id, food_plan_id, name, anchor_role, is_default, sort_order)
  select (e->>'id')::uuid, p_user_id, v_plan.id, e->>'name',
         nullif(e->>'anchor_role','')::text, coalesce((e->>'is_default')::boolean, false), (e->>'sort_order')::int
  from jsonb_array_elements(coalesce(p_meals, '[]'::jsonb)) e;

  insert into public.food_plan_days (id, user_id, food_plan_id, sort_order)
  select (e->>'id')::uuid, p_user_id, v_plan.id, (e->>'sort_order')::int
  from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) e;

  insert into public.day_meals (id, user_id, food_plan_id, day_id, meal_id)
  select (e->>'id')::uuid, p_user_id, v_plan.id, (e->>'day_id')::uuid, (e->>'meal_id')::uuid
  from jsonb_array_elements(coalesce(p_day_meals, '[]'::jsonb)) e;

  return v_plan;
end;
$$;
revoke execute on function public.create_food_plan from public, anon;
grant  execute on function public.create_food_plan to   authenticated;

-- 8.7 add_food_plan_day: server-authoritative. A new day schedules ONLY the
-- plan's is_default Meals; custom Meals stay omitted until explicitly added.
create or replace function public.add_food_plan_day(
  p_user_id uuid, p_food_plan_id uuid, p_sort_order int
)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_day uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.food_plans fp where fp.id = p_food_plan_id and fp.user_id = p_user_id) then
    raise exception 'food plan not found' using errcode = 'P0002';
  end if;

  insert into public.food_plan_days (user_id, food_plan_id, sort_order)
  values (p_user_id, p_food_plan_id, p_sort_order)
  returning id into v_day;

  insert into public.day_meals (user_id, food_plan_id, day_id, meal_id)
  select p_user_id, p_food_plan_id, v_day, m.id
  from public.meals m where m.food_plan_id = p_food_plan_id and m.is_default;
end;
$$;
revoke execute on function public.add_food_plan_day from public, anon;
grant  execute on function public.add_food_plan_day to   authenticated;

-- 8.7 add_meal_definition: server-authoritative. A new (non-default) Meal is
-- scheduled on EVERY current day.
create or replace function public.add_meal_definition(
  p_user_id uuid, p_food_plan_id uuid, p_name text, p_sort_order int
)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_meal uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.food_plans fp where fp.id = p_food_plan_id and fp.user_id = p_user_id) then
    raise exception 'food plan not found' using errcode = 'P0002';
  end if;

  insert into public.meals (user_id, food_plan_id, name, anchor_role, is_default, sort_order)
  values (p_user_id, p_food_plan_id, p_name, null, false, p_sort_order)
  returning id into v_meal;

  insert into public.day_meals (user_id, food_plan_id, day_id, meal_id)
  select p_user_id, p_food_plan_id, d.id, v_meal
  from public.food_plan_days d where d.food_plan_id = p_food_plan_id;
end;
$$;
revoke execute on function public.add_meal_definition from public, anon;
grant  execute on function public.add_meal_definition to   authenticated;

-- 8.7 duplicate_food_plan_day: server-authoritative. Copies the LIVE source
-- day's day_meals (and their entries) onto a new day. Trusts no client payload.
create or replace function public.duplicate_food_plan_day(
  p_user_id uuid, p_source_day_id uuid, p_sort_order int
)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_plan uuid;
  v_new_day uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select food_plan_id into v_plan
  from public.food_plan_days where id = p_source_day_id and user_id = p_user_id;
  if not found then
    raise exception 'source day not found' using errcode = 'P0002';
  end if;

  insert into public.food_plan_days (user_id, food_plan_id, day_type_override, sort_order)
  select p_user_id, v_plan, day_type_override, p_sort_order
  from public.food_plan_days where id = p_source_day_id
  returning id into v_new_day;

  -- Copy day_meals (mapping old->new via meal_id, which is unique within a day),
  -- then copy each source entry onto the matching new day_meal. One statement.
  with src as (
    select id as old_id, meal_id from public.day_meals where day_id = p_source_day_id
  ), ins as (
    insert into public.day_meals (user_id, food_plan_id, day_id, meal_id)
    select p_user_id, v_plan, v_new_day, meal_id from src
    returning id as new_id, meal_id
  )
  insert into public.food_plan_entries
    (user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order)
  select p_user_id, v_plan, ins.new_id, false, e.food_item_id, e.basis, e.amount, e.sort_order
  from public.food_plan_entries e
  join src on src.old_id = e.day_meal_id
  join ins on ins.meal_id = src.meal_id;
end;
$$;
revoke execute on function public.duplicate_food_plan_day from public, anon;
grant  execute on function public.duplicate_food_plan_day to   authenticated;

-- 8.7 upsert_food_plan_entry: concurrency-safe, cap-safe ADD / COPY / MOVE / MERGE.
-- Advisory lock on (plan, food) serializes all moves and additions for that food,
-- including opposite-direction moves (SELECT FOR UPDATE locks nothing when the
-- target is empty). A move to an empty target relocates the source IN PLACE
-- (no insert => safe at the cap);
-- a move to an occupied target merges then deletes the source; a same-location
-- move is a no-op. Mixed-basis merge is combined server-side in p_preserve_basis.
create or replace function public.upsert_food_plan_entry(
  p_user_id uuid,
  p_entry jsonb,          -- {id, food_plan_id, day_meal_id|null, is_extra, food_item_id, basis, amount, sort_order}
  p_preserve_basis text,  -- on merge: basis to keep; null => keep the existing entry's basis
  p_move_source_id uuid   -- entry being relocated; null on add/copy
)
returns public.food_plan_entries
language plpgsql security invoker set search_path = '' as $$
declare
  v_plan   uuid    := (p_entry->>'food_plan_id')::uuid;
  v_dm     uuid    := nullif(p_entry->>'day_meal_id','')::uuid;
  v_extra  boolean := (p_entry->>'is_extra')::boolean;
  v_food   uuid    := (p_entry->>'food_item_id')::uuid;
  v_basis  text    := p_entry->>'basis';
  v_amount numeric := (p_entry->>'amount')::numeric;
  v_sort   int     := (p_entry->>'sort_order')::int;
  v_sw numeric; v_spp numeric;
  v_source   public.food_plan_entries;
  v_existing public.food_plan_entries;
  v_found boolean := false;
  v_keep text; v_existing_eff numeric; v_add_eff numeric; v_combined numeric; v_new_amount numeric;
  v_result public.food_plan_entries;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.food_plans fp where fp.id = v_plan and fp.user_id = p_user_id) then
    raise exception 'food plan not found' using errcode = 'P0002';
  end if;

  select fi.serving_weight_grams, fi.servings_per_package into v_sw, v_spp
  from public.food_items fi where fi.id = v_food and fi.user_id = p_user_id;
  if not found then raise exception 'food not found' using errcode = 'P0002'; end if;

  -- target location belongs to this plan
  if v_extra then
    if v_dm is not null then raise exception 'extras entry must not target a cell' using errcode = '22023'; end if;
  else
    if v_dm is null then raise exception 'cell entry requires a day_meal' using errcode = '22023'; end if;
    if not exists (select 1 from public.day_meals d where d.id = v_dm and d.food_plan_id = v_plan) then
      raise exception 'day_meal not in plan' using errcode = 'P0002';
    end if;
  end if;

  -- addition basis valid for the food (trigger also enforces)
  if v_basis = 'packages' and (v_spp is null or v_spp <= 0) then
    raise exception 'packages basis requires servings_per_package' using errcode = '22023';
  end if;
  if v_basis = 'weight' and (v_sw is null or v_sw <= 0) then
    raise exception 'weight basis requires serving_weight_grams' using errcode = '22023';
  end if;

  -- Serialize ALL concurrent writers touching this (plan, food) BEFORE any row
  -- lock. Keying on (plan, food) - not location - means opposite-direction moves
  -- of the same food (A->B while B->A) cannot grab source/target rows in opposite
  -- orders and deadlock. It also covers the empty-target race (an empty SELECT
  -- FOR UPDATE locks nothing). Same-food ops within one plan serialize; acceptable.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_plan::text || ':' || v_food::text, 0));

  -- MOVE: validate + lock the source. The LIVE source row is authoritative for
  -- the moved quantity; p_entry only describes the destination. A same-location
  -- move is a no-op.
  if p_move_source_id is not null then
    select * into v_source from public.food_plan_entries
      where id = p_move_source_id and user_id = p_user_id
        and food_plan_id = v_plan and food_item_id = v_food
      for update;
    if not found then raise exception 'source entry not found in plan' using errcode = 'P0002'; end if;
    if v_source.is_extra = v_extra and (v_source.day_meal_id is not distinct from v_dm) then
      return v_source;  -- moving onto its own location: no-op
    end if;
  end if;

  if v_extra then
    select * into v_existing from public.food_plan_entries
      where food_plan_id = v_plan and is_extra and food_item_id = v_food for update;
  else
    select * into v_existing from public.food_plan_entries
      where day_meal_id = v_dm and food_item_id = v_food for update;
  end if;
  v_found := found;

  if v_found then
    -- MERGE into the existing target row, in the preservation basis. For a MOVE
    -- the added quantity comes from the LOCKED source row, never from p_entry.
    v_keep := coalesce(nullif(p_preserve_basis,''), v_existing.basis);
    if v_keep = 'packages' and (v_spp is null or v_spp <= 0) then
      raise exception 'preservation basis packages requires servings_per_package' using errcode = '22023';
    end if;
    if v_keep = 'weight' and (v_sw is null or v_sw <= 0) then
      raise exception 'preservation basis weight requires serving_weight_grams' using errcode = '22023';
    end if;
    v_existing_eff := case v_existing.basis when 'servings' then v_existing.amount when 'packages' then v_existing.amount * v_spp when 'weight' then v_existing.amount / v_sw end;
    if p_move_source_id is not null then
      -- moved quantity = the live source row (authoritative), not p_entry
      v_add_eff := case v_source.basis when 'servings' then v_source.amount when 'packages' then v_source.amount * v_spp when 'weight' then v_source.amount / v_sw end;
    else
      v_add_eff := case v_basis when 'servings' then v_amount when 'packages' then v_amount * v_spp when 'weight' then v_amount / v_sw end;
    end if;
    v_combined := v_existing_eff + v_add_eff;
    v_new_amount := case v_keep when 'servings' then v_combined when 'packages' then v_combined / v_spp when 'weight' then v_combined * v_sw end;
    update public.food_plan_entries set basis = v_keep, amount = v_new_amount
      where id = v_existing.id returning * into v_result;
    if p_move_source_id is not null and p_move_source_id <> v_result.id then
      delete from public.food_plan_entries where id = p_move_source_id and user_id = p_user_id;
    end if;
  else
    if p_move_source_id is not null then
      -- MOVE to an empty target: relocate IN PLACE (no insert => safe at the cap).
      update public.food_plan_entries
        set day_meal_id = v_dm, is_extra = v_extra, sort_order = v_sort
        where id = p_move_source_id and user_id = p_user_id
        returning * into v_result;
    else
      -- ADD / COPY to an empty target: insert.
      insert into public.food_plan_entries
        (id, user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order)
      values ((p_entry->>'id')::uuid, p_user_id, v_plan, v_dm, v_extra, v_food, v_basis, v_amount, v_sort)
      returning * into v_result;
    end if;
  end if;

  return v_result;
end;
$$;
revoke execute on function public.upsert_food_plan_entry from public, anon;
grant  execute on function public.upsert_food_plan_entry to   authenticated;

-- 8.8 extend bulk_update_sort_order with the new orderable tables (current body
-- from 20260524140830 plus four elsif branches).
create or replace function public.bulk_update_sort_order(
  p_table text, p_ids uuid[], p_orders int[]
)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if array_length(p_ids, 1) is distinct from array_length(p_orders, 1) then
    raise exception 'ids and orders length mismatch';
  end if;
  if array_length(p_ids, 1) is null then return; end if;

  if p_table = 'categories' then
    update public.categories set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where categories.id = data.id and categories.user_id = auth.uid()
      and categories.sort_order is distinct from data.sort_order;
  elsif p_table = 'list_items' then
    update public.list_items set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order), public.lists
    where list_items.id = data.id and lists.id = list_items.list_id
      and lists.user_id = auth.uid() and list_items.sort_order is distinct from data.sort_order;
  elsif p_table = 'gear_items' then
    update public.gear_items set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where gear_items.id = data.id and gear_items.user_id = auth.uid()
      and gear_items.sort_order is distinct from data.sort_order;
  elsif p_table = 'lists' then
    update public.lists set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where lists.id = data.id and lists.user_id = auth.uid()
      and lists.sort_order is distinct from data.sort_order;
  elsif p_table = 'food_items' then
    update public.food_items set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where food_items.id = data.id and food_items.user_id = auth.uid()
      and food_items.sort_order is distinct from data.sort_order;
  elsif p_table = 'food_plan_days' then
    update public.food_plan_days set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where food_plan_days.id = data.id and food_plan_days.user_id = auth.uid()
      and food_plan_days.sort_order is distinct from data.sort_order;
  elsif p_table = 'meals' then
    update public.meals set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where meals.id = data.id and meals.user_id = auth.uid()
      and meals.sort_order is distinct from data.sort_order;
  elsif p_table = 'food_plan_entries' then
    update public.food_plan_entries set sort_order = data.sort_order
    from unnest(p_ids, p_orders) as data(id, sort_order)
    where food_plan_entries.id = data.id and food_plan_entries.user_id = auth.uid()
      and food_plan_entries.sort_order is distinct from data.sort_order;
  else
    raise exception 'invalid table: %', p_table;
  end if;
end;
$$;
revoke execute on function public.bulk_update_sort_order from public, anon;
grant  execute on function public.bulk_update_sort_order to   authenticated;
