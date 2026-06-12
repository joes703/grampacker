-- Food plan core: plan + Meal definitions + days + the day x Meal schedule
-- grid + entries. Owner-only, per-plan caps, basis-validated, never anon-reachable.
-- Composite FKs ((id, user_id) / (id, food_plan_id) uniques + two-column
-- references) prevent cross-tenant and cross-plan stitching structurally.

-- 1.2 food_plans: zero or one per gear list. num_nights is CONTEXT ONLY; the
-- number of days is the count of food_plan_days rows, entered explicitly.
create table public.food_plans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  list_id         uuid not null,
  num_nights      integer check (num_nights is null or num_nights between 0 and 999),
  is_food_shared  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint food_plans_list_id_key    unique (list_id),
  constraint food_plans_id_user_id_key unique (id, user_id),
  constraint food_plans_list_id_fkey
    foreign key (list_id, user_id) references public.lists(id, user_id) on delete cascade
);

-- 1.3 meals: plan-scoped Meal definitions. is_default marks the seeded three
-- (Breakfast/On-trail food/Dinner); anchor_role alone cannot identify On-trail food.
create table public.meals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  food_plan_id  uuid not null,
  name          text not null check (char_length(name) between 1 and 128),
  anchor_role   text check (anchor_role in ('breakfast','dinner')),
  is_default    boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint meals_id_food_plan_id_key unique (id, food_plan_id),
  constraint meals_food_plan_id_fkey
    foreign key (food_plan_id, user_id) references public.food_plans(id, user_id) on delete cascade
);
create unique index meals_one_anchor_per_role_idx
  on public.meals (food_plan_id, anchor_role) where anchor_role is not null;

-- 1.4 food_plan_days.
create table public.food_plan_days (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  food_plan_id       uuid not null,
  day_type_override  text check (day_type_override in ('full','partial')),  -- null = Auto
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint food_plan_days_id_food_plan_id_key unique (id, food_plan_id),
  constraint food_plan_days_food_plan_id_fkey
    foreign key (food_plan_id, user_id) references public.food_plans(id, user_id) on delete cascade
);

-- 1.5 day_meals: the authoritative day x Meal schedule grid.
create table public.day_meals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  food_plan_id  uuid not null,
  day_id        uuid not null,
  meal_id       uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint day_meals_day_meal_key        unique (day_id, meal_id),
  constraint day_meals_id_food_plan_id_key unique (id, food_plan_id),
  constraint day_meals_food_plan_id_fkey
    foreign key (food_plan_id, user_id) references public.food_plans(id, user_id) on delete cascade,
  constraint day_meals_day_id_fkey
    foreign key (day_id, food_plan_id) references public.food_plan_days(id, food_plan_id) on delete cascade,
  constraint day_meals_meal_id_fkey
    foreign key (meal_id, food_plan_id) references public.meals(id, food_plan_id) on delete cascade
);

-- 1.6 food_plan_entries: one quantity of one library food in a (day, Meal) cell or in Extras.
create table public.food_plan_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  food_plan_id  uuid not null,
  day_meal_id   uuid,                 -- null => Extras
  is_extra      boolean not null default false,
  food_item_id  uuid not null,
  basis         text not null check (basis in ('servings','packages','weight')),
  amount        numeric(12,3) not null check (amount > 0),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint entry_location_xor check (
    (is_extra and day_meal_id is null) or (not is_extra and day_meal_id is not null)
  ),
  constraint food_plan_entries_food_plan_id_fkey
    foreign key (food_plan_id, user_id) references public.food_plans(id, user_id) on delete cascade,
  constraint food_plan_entries_day_meal_id_fkey
    foreign key (day_meal_id, food_plan_id) references public.day_meals(id, food_plan_id) on delete cascade,
  constraint food_plan_entries_food_item_id_fkey
    foreign key (food_item_id, user_id) references public.food_items(id, user_id) on delete cascade
);
create unique index entry_one_per_cell_idx
  on public.food_plan_entries (day_meal_id, food_item_id) where day_meal_id is not null;
create unique index entry_one_per_extras_idx
  on public.food_plan_entries (food_plan_id, food_item_id) where is_extra;

create index meals_plan_idx             on public.meals (food_plan_id, sort_order);
create index food_plan_days_plan_idx    on public.food_plan_days (food_plan_id, sort_order);
create index day_meals_plan_idx         on public.day_meals (food_plan_id);
create index day_meals_meal_idx         on public.day_meals (meal_id, food_plan_id);          -- supports day_meals_meal_id_fkey
create index food_plan_entries_plan_idx on public.food_plan_entries (food_plan_id, sort_order);
create index food_plan_entries_food_idx on public.food_plan_entries (food_item_id, user_id);  -- supports food_plan_entries_food_item_id_fkey

-- Leading user_id indexes back the FK to profiles(id) (profile delete, takeout, user-scoped reads).
create index food_plans_user_idx        on public.food_plans (user_id);
create index meals_user_idx             on public.meals (user_id);
create index food_plan_days_user_idx    on public.food_plan_days (user_id);
create index day_meals_user_idx         on public.day_meals (user_id);
create index food_plan_entries_user_idx on public.food_plan_entries (user_id);

-- RLS: owner-only on every table (plain auth.uid() form, matching food_items).
alter table public.food_plans        enable row level security;
alter table public.meals             enable row level security;
alter table public.food_plan_days    enable row level security;
alter table public.day_meals         enable row level security;
alter table public.food_plan_entries enable row level security;

create policy food_plans_owner_all on public.food_plans
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy meals_owner_all on public.meals
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy food_plan_days_owner_all on public.food_plan_days
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy day_meals_owner_all on public.day_meals
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy food_plan_entries_owner_all on public.food_plan_entries
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger food_plans_updated_at        before update on public.food_plans        for each row execute function public.set_updated_at();
create trigger meals_updated_at             before update on public.meals             for each row execute function public.set_updated_at();
create trigger food_plan_days_updated_at    before update on public.food_plan_days    for each row execute function public.set_updated_at();
create trigger day_meals_updated_at         before update on public.day_meals         for each row execute function public.set_updated_at();
create trigger food_plan_entries_updated_at before update on public.food_plan_entries for each row execute function public.set_updated_at();

-- Per-plan cap triggers (design 13). search_path = '' + revoke direct execute.
create function public.check_food_plan_day_limit()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Lock the parent plan row so concurrent inserts cannot both read count = N-1
  -- and both slip past the cap. Serializes inserts per plan; acceptable.
  perform 1 from public.food_plans where id = new.food_plan_id for update;
  if (select count(*) from public.food_plan_days where food_plan_id = new.food_plan_id) >= 60 then
    raise exception 'Food plan day limit reached (60 per plan)';
  end if;
  return new;
end;
$$;
revoke all on function public.check_food_plan_day_limit() from public, anon, authenticated;
create trigger food_plan_days_limit before insert on public.food_plan_days
  for each row execute function public.check_food_plan_day_limit();

create function public.check_meal_definition_limit()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform 1 from public.food_plans where id = new.food_plan_id for update;
  if (select count(*) from public.meals where food_plan_id = new.food_plan_id) >= 20 then
    raise exception 'Meal definition limit reached (20 per plan)';
  end if;
  return new;
end;
$$;
revoke all on function public.check_meal_definition_limit() from public, anon, authenticated;
create trigger meals_limit before insert on public.meals
  for each row execute function public.check_meal_definition_limit();

create function public.check_food_plan_entry_limit()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform 1 from public.food_plans where id = new.food_plan_id for update;
  if (select count(*) from public.food_plan_entries where food_plan_id = new.food_plan_id) >= 2000 then
    raise exception 'Food plan entry limit reached (2000 per plan)';
  end if;
  return new;
end;
$$;
revoke all on function public.check_food_plan_entry_limit() from public, anon, authenticated;
create trigger food_plan_entries_limit before insert on public.food_plan_entries
  for each row execute function public.check_food_plan_entry_limit();

-- Basis-validation trigger: "unknown never becomes zero". A packages-basis entry
-- requires the food to declare servings_per_package; a weight-basis entry
-- requires serving_weight_grams. Enforced on EVERY write path. Fires regardless
-- of EXECUTE, so direct execution is revoked.
create function public.validate_food_plan_entry_basis()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_spp numeric;
  v_sw  numeric;
begin
  select fi.servings_per_package, fi.serving_weight_grams into v_spp, v_sw
  from public.food_items fi where fi.id = new.food_item_id;
  if new.basis = 'packages' and (v_spp is null or v_spp <= 0) then
    raise exception 'packages basis requires servings_per_package' using errcode = '22023';
  end if;
  if new.basis = 'weight' and (v_sw is null or v_sw <= 0) then
    raise exception 'weight basis requires serving_weight_grams' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_food_plan_entry_basis() from public, anon, authenticated;
create trigger food_plan_entries_validate_basis
  before insert or update on public.food_plan_entries
  for each row execute function public.validate_food_plan_entry_basis();

-- Grant matrix (design 6.2 / 7.2): authenticated + service_role CRUD; NO anon.
revoke all on table public.food_plans, public.meals, public.food_plan_days,
                    public.day_meals, public.food_plan_entries
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table
  public.food_plans, public.meals, public.food_plan_days,
  public.day_meals, public.food_plan_entries to authenticated;
grant select, insert, update, delete on table
  public.food_plans, public.meals, public.food_plan_days,
  public.day_meals, public.food_plan_entries to service_role;
