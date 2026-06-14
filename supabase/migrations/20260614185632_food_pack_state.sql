-- Phase 4: owner-private packed state for the derived Food projection.
-- The projection itself is NEVER list_items/gear_items (design 5.1/5.2); only this
-- checkbox is persisted state. Sparse rows: absence means unpacked. Never public.
create table public.food_pack_state (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  food_plan_id      uuid not null,
  food_item_id      uuid not null,
  is_packed         boolean not null default false,
  packed_signature  text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint food_pack_state_key unique (food_plan_id, food_item_id),
  -- A packed row always carries a signature; an unpacked row never does. This makes
  -- "packed but no signature to compare" structurally impossible.
  constraint food_pack_state_sig_consistency check (
    (is_packed and packed_signature <> '') or (not is_packed and packed_signature = '')
  ),
  constraint food_pack_state_food_plan_id_fkey
    foreign key (food_plan_id, user_id) references public.food_plans(id, user_id) on delete cascade,
  constraint food_pack_state_food_item_id_fkey
    foreign key (food_item_id, user_id) references public.food_items(id, user_id) on delete cascade
);

create index food_pack_state_user_idx on public.food_pack_state (user_id);
-- Backs the (food_plan_id, user_id) composite FK to food_plans (plan-delete cascade);
-- the (food_plan_id, food_item_id) unique key does not cover user_id.
create index food_pack_state_plan_idx on public.food_pack_state (food_plan_id, user_id);
-- Backs the (food_item_id, user_id) composite FK to food_items (food-delete cascade).
create index food_pack_state_food_idx on public.food_pack_state (food_item_id, user_id);

alter table public.food_pack_state enable row level security;

-- Owner-only. (select auth.uid()) is wrapped so the planner caches it once per
-- statement (auth_rls_initplan advisor); a single FOR ALL policy keeps one policy
-- per (role, action) (multiple_permissive_policies advisor).
create policy food_pack_state_owner_all on public.food_pack_state
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create trigger food_pack_state_updated_at before update on public.food_pack_state
  for each row execute function public.set_updated_at();

-- Grant matrix (design 6.2): authenticated + service_role CRUD; NO anon; never public.
revoke all on table public.food_pack_state from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.food_pack_state to authenticated;
grant select, insert, update, delete on table public.food_pack_state to service_role;

-- Transaction advisory-lock key for a food plan. The pack RPC and the cleanup
-- trigger both take pg_advisory_xact_lock on this key, serializing all food-pack
-- operations WITHIN a plan. Keyed by plan ONLY (not per food): a cascade that deletes
-- several foods would otherwise acquire per-food locks in row order, and two such
-- cascades on different days could deadlock (xact advisory locks are held to commit).
-- A single plan-level lock has no ordering hazard; the workload is small enough that
-- serializing a plan's pack operations is the safer tradeoff. Defined before the
-- trigger that uses it. hashtextextended resolves from pg_catalog (always on the
-- path) under search_path=''.
create function public.food_pack_lock_key(p_food_plan_id uuid)
returns bigint language sql immutable set search_path = '' as $$
  select hashtextextended('food_pack_state:' || p_food_plan_id::text, 0)
$$;
revoke all on function public.food_pack_lock_key(uuid) from public, anon, authenticated, service_role;
grant execute on function public.food_pack_lock_key(uuid) to authenticated, service_role;

-- Backs the trigger's "any entries left for (plan, food)?" probe so the per-row
-- check stays cheap even on a day/meal cascade delete (existing food_plan_entries
-- indexes lead with sort_order or food_item_id, not this pair).
create index food_plan_entries_plan_food_idx
  on public.food_plan_entries (food_plan_id, food_item_id);

-- When the last food_plan_entries row for a (plan, food) is deleted, drop any
-- food_pack_state for it so a later re-add cannot inherit a stale packed signature,
-- and so no orphan state lingers for a food that is no longer projected. Other
-- removal paths (food delete, plan delete) are FK cascades; this covers entry-level
-- and day/meal-cascade deletes. SECURITY INVOKER (runs as the deleting owner, who
-- holds delete on food_pack_state and passes RLS for their own rows).
create function public.cleanup_food_pack_state_on_entry_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Serialize against concurrent deletes/packs for this PLAN. Without it, two
  -- transactions each deleting one of a food's final two entries would, under Read
  -- Committed, each still see the other's row and neither would clean up. The
  -- plan-level xact lock makes the second committer re-read after the first commits
  -- and observe zero remaining entries; keying by plan (not food) avoids the
  -- cross-food lock-ordering deadlock a multi-food cascade could hit.
  perform pg_advisory_xact_lock(public.food_pack_lock_key(old.food_plan_id));
  if not exists (
    select 1 from public.food_plan_entries
    where food_plan_id = old.food_plan_id and food_item_id = old.food_item_id
  ) then
    delete from public.food_pack_state
    where food_plan_id = old.food_plan_id and food_item_id = old.food_item_id;
  end if;
  return old;
end;
$$;
-- Trigger function: full revoke, no grant (fired by the trigger, never callable).
revoke all on function public.cleanup_food_pack_state_on_entry_delete() from public, anon, authenticated, service_role;
create trigger food_plan_entries_cleanup_pack_state
  after delete on public.food_plan_entries
  for each row execute function public.cleanup_food_pack_state_on_entry_delete();

-- Canonical packed signature: division-free total packed grams + serving weight,
-- each trim_scale'd (2.0 == 2.000), joined by '|' (cannot occur in a numeric text).
create function public.food_pack_signature(
  p_total_packed_weight_grams numeric,
  p_serving_weight_grams numeric
) returns text language sql immutable set search_path = '' as $$
  select trim_scale(p_total_packed_weight_grams)::text || '|' || trim_scale(p_serving_weight_grams)::text
$$;
revoke all on function public.food_pack_signature(numeric, numeric) from public, anon, authenticated, service_role;
grant execute on function public.food_pack_signature(numeric, numeric) to authenticated, service_role;

-- Per-food current signature for one list's plan. SECURITY INVOKER: RLS authorizes;
-- the explicit identity guard makes a mismatched p_user_id a hard 42501, not a silent
-- empty result. A food with any packages entry lacking servings_per_package is
-- INCOMPLETE: returns NULL signature, never a silently-undercounted partial SUM.
create function public.get_food_pack_signatures(p_user_id uuid, p_list_id uuid)
returns table(food_item_id uuid, current_signature text)
language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select auth.uid()) <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return query
    select e.food_item_id,
           case when bool_and(
                  case e.basis when 'packages'
                    then fi.servings_per_package is not null and fi.servings_per_package > 0
                    else true end)
                then public.food_pack_signature(
                       sum(case e.basis
                             when 'servings' then e.amount * fi.serving_weight_grams
                             when 'packages' then e.amount * fi.servings_per_package * fi.serving_weight_grams
                             when 'weight'   then e.amount
                           end),
                       fi.serving_weight_grams)
                else null
           end as current_signature
    from public.food_plan_entries e
    join public.food_plans fp on fp.id = e.food_plan_id and fp.user_id = e.user_id
    join public.food_items fi on fi.id = e.food_item_id and fi.user_id = e.user_id
    where fp.list_id = p_list_id and e.user_id = p_user_id
    group by e.food_item_id, fi.serving_weight_grams;
end;
$$;
revoke all on function public.get_food_pack_signatures(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_food_pack_signatures(uuid, uuid) to authenticated, service_role;

-- Toggle one food's packed state. Acquires the plan-level advisory lock (serializes
-- concurrent packs), computes completeness + signature in ONE select, validates, and
-- upserts in the same transaction. Packing requires complete metadata and a matching
-- expected signature. SECURITY INVOKER + RLS authorize.
create function public.set_food_pack_state(
  p_user_id uuid,
  p_list_id uuid,
  p_food_item_id uuid,
  p_is_packed boolean,
  p_expected_signature text
) returns public.food_pack_state
language plpgsql security invoker set search_path = '' as $$
declare
  v_plan_id uuid;
  v_complete boolean;
  v_sig text;
  v_row public.food_pack_state;
begin
  if (select auth.uid()) is null or (select auth.uid()) <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select fp.id into v_plan_id
    from public.food_plans fp where fp.list_id = p_list_id and fp.user_id = p_user_id;
  if v_plan_id is null then
    raise exception 'food plan not found for list' using errcode = 'P0002';
  end if;
  -- Serialize this plan's pack operations and last-entry cleanup with a plan-level
  -- transaction advisory lock (plan-keyed to avoid the cross-food lock-ordering
  -- deadlock a multi-food cascade could hit). An entry edit committed before the
  -- signature SELECT below is rejected by the expected-signature compare; one
  -- committed after stores an old signature that renders unpacked on the next read.
  perform pg_advisory_xact_lock(public.food_pack_lock_key(v_plan_id));

  select bool_and(
           case e.basis when 'packages'
             then fi.servings_per_package is not null and fi.servings_per_package > 0
             else true end),
         public.food_pack_signature(
           sum(case e.basis
                 when 'servings' then e.amount * fi.serving_weight_grams
                 when 'packages' then e.amount * fi.servings_per_package * fi.serving_weight_grams
                 when 'weight'   then e.amount
               end),
           fi.serving_weight_grams)
    into v_complete, v_sig
    from public.food_plan_entries e
    join public.food_items fi on fi.id = e.food_item_id and fi.user_id = e.user_id
    where e.food_plan_id = v_plan_id and e.food_item_id = p_food_item_id and e.user_id = p_user_id
    group by fi.serving_weight_grams;

  if not found then
    raise exception 'food not in plan' using errcode = '23503';
  end if;

  if p_is_packed then
    if not v_complete then
      raise exception 'food has incomplete packaging metadata' using errcode = '22023';
    end if;
    -- Packing REQUIRES the caller's expected signature, and it must match the freshly
    -- computed one. A NULL expected signature is rejected too: we never pack a
    -- quantity the client did not explicitly confirm. PT409 -> HTTP 409 (P0003 is
    -- reserved by Postgres for too_many_rows).
    if p_expected_signature is null or p_expected_signature <> v_sig then
      raise exception 'pack signature missing or stale' using errcode = 'PT409';
    end if;
  end if;

  insert into public.food_pack_state (user_id, food_plan_id, food_item_id, is_packed, packed_signature)
    values (p_user_id, v_plan_id, p_food_item_id, p_is_packed, case when p_is_packed then v_sig else '' end)
    on conflict (food_plan_id, food_item_id) do update
      set is_packed = excluded.is_packed,
          packed_signature = excluded.packed_signature
    returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.set_food_pack_state(uuid, uuid, uuid, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.set_food_pack_state(uuid, uuid, uuid, boolean, text) to authenticated, service_role;
