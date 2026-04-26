-- Phase 2: categories and gear_items.
-- Requires Phase 1 migration (profiles, set_updated_at) to already be applied.

-- ============================================================
-- categories
-- ============================================================

create table public.categories (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  name       text        not null check (length(name) <= 128),
  sort_order integer     not null default 0,
  is_default boolean     not null default false,
  created_at timestamptz not null default now()
);

create index categories_user_sort_idx on public.categories (user_id, sort_order, name);

alter table public.categories enable row level security;

create policy categories_owner_all on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- gear_items
-- ============================================================

create table public.gear_items (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  category_id  uuid        references public.categories(id) on delete set null,
  name         text        not null check (length(name) between 1 and 256),
  description  text        check (length(description) <= 2000),
  weight_grams integer     not null default 0 check (weight_grams between 0 and 100000),
  sort_order   integer     not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index gear_items_user_idx           on public.gear_items (user_id, sort_order, name);
create index gear_items_user_name_lower_idx on public.gear_items (user_id, lower(name));

alter table public.gear_items enable row level security;

create policy gear_items_owner_all on public.gear_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at trigger (reuses function from Phase 1)
create trigger gear_items_updated_at
  before update on public.gear_items
  for each row execute function public.set_updated_at();

-- 500-item-per-user cap
create function public.check_gear_item_limit()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.gear_items where user_id = new.user_id) >= 500 then
    raise exception 'Gear item limit reached (500 per user)';
  end if;
  return new;
end;
$$;

create trigger gear_items_limit
  before insert on public.gear_items
  for each row execute function public.check_gear_item_limit();
