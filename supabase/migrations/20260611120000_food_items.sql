-- Food library: account-wide food definitions (inventory of foods).
-- Owner-only, capped at 1000 per user, and NEVER reachable by anon.
--
-- Reachability vs authorization (see technical design 6.2):
--   GRANT      = a Data API role can address the table at all.
--   RLS policy = which rows that role may see / write.
-- Food base tables get NO anon grant: public food reads (a later phase)
-- go exclusively through curated public views, never the base table.

create table public.food_items (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles(id) on delete cascade,
  name                  text not null check (char_length(name) between 1 and 256),
  brand                 text        check (char_length(brand) <= 256),
  serving_description   text        check (char_length(serving_description) <= 256),
  serving_weight_grams  numeric(10,3) not null check (serving_weight_grams > 0),
  calories_per_serving  numeric(10,2) not null check (calories_per_serving >= 0),
  servings_per_package  numeric(10,3)        check (servings_per_package > 0),
  fat_grams             numeric(10,2)        check (fat_grams           >= 0),
  saturated_fat_grams   numeric(10,2)        check (saturated_fat_grams >= 0),
  carbs_grams           numeric(10,2)        check (carbs_grams         >= 0),
  fiber_grams           numeric(10,2)        check (fiber_grams         >= 0),
  sugar_grams           numeric(10,2)        check (sugar_grams         >= 0),
  protein_grams         numeric(10,2)        check (protein_grams       >= 0),
  sodium_mg             numeric(10,1)        check (sodium_mg           >= 0),
  potassium_mg          numeric(10,1)        check (potassium_mg        >= 0),
  notes                 text        check (char_length(notes) <= 2000),
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint food_items_id_user_id_key unique (id, user_id)
);

create index food_items_user_sort_idx        on public.food_items (user_id, sort_order, name);
create index food_items_user_name_lower_idx  on public.food_items (user_id, lower(name));
create index food_items_user_brand_lower_idx on public.food_items (user_id, lower(brand));

-- RLS: owner-only. (The ensure_rls event trigger also enables RLS, but be explicit.)
alter table public.food_items enable row level security;

create policy food_items_owner_all on public.food_items
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at maintenance (shared trigger function from the initial schema).
create trigger food_items_updated_at
  before update on public.food_items
  for each row execute function public.set_updated_at();

-- 1000-food-per-user cap (technical design 13). search_path = '' pins object
-- resolution (all identifiers are fully schema-qualified) per the function
-- hardening convention (20260429000000 / 20260514202025).
create function public.check_food_item_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.food_items where user_id = new.user_id) >= 1000 then
    raise exception 'Food item limit reached (1000 per user)';
  end if;
  return new;
end;
$$;

-- The trigger fires regardless of EXECUTE (trigger firing does not check it),
-- so revoke direct Data API execution. No role should be able to call this
-- function as an RPC.
revoke all on function public.check_food_item_limit() from public, anon, authenticated;

create trigger food_items_limit
  before insert on public.food_items
  for each row execute function public.check_food_item_limit();

-- Explicit Data API grant matrix (technical design 6.2).
-- anon intentionally gets NO grant: food base tables are never anon-reachable.
revoke all on table public.food_items from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.food_items to authenticated;
grant select, insert, update, delete on table public.food_items to service_role;
