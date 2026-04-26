-- ============================================================
-- lists
-- ============================================================
create table lists (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  name         text not null check (char_length(name) between 1 and 256),
  description  text check (char_length(description) <= 2000),
  share_token  text not null unique check (char_length(share_token) = 8),
  is_shared    boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table lists enable row level security;

create policy "lists_owner_all" on lists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "lists_public_select_shared" on lists
  for select using (is_shared = true);

-- updated_at trigger (reuses the function from the initial schema migration)
create trigger set_lists_updated_at
  before update on lists
  for each row execute function set_updated_at();

-- 100-list-per-user cap
create or replace function check_list_cap()
returns trigger language plpgsql as $$
begin
  if (select count(*) from lists where user_id = new.user_id) >= 100 then
    raise exception 'list cap reached: maximum 100 lists per user';
  end if;
  return new;
end;
$$;

create trigger enforce_list_cap
  before insert on lists
  for each row execute function check_list_cap();

-- ============================================================
-- list_items
-- ============================================================
create table list_items (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references lists on delete cascade,
  gear_item_id  uuid references gear_items on delete set null,
  quantity      integer not null default 1 check (quantity between 1 and 99),
  weight_grams  integer not null check (weight_grams between 0 and 100000),
  is_worn       boolean not null default false,
  is_consumable boolean not null default false,
  is_packed     boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- a list item cannot be both worn and consumable
  constraint worn_xor_consumable check (not (is_worn and is_consumable))
);

alter table list_items enable row level security;

-- owners access their own list items
create policy "list_items_owner_all" on list_items
  for all using (
    exists (select 1 from lists where lists.id = list_items.list_id and lists.user_id = auth.uid())
  )
  with check (
    exists (select 1 from lists where lists.id = list_items.list_id and lists.user_id = auth.uid())
  );

-- public can read items in shared lists
create policy "list_items_public_select_shared" on list_items
  for select using (
    exists (select 1 from lists where lists.id = list_items.list_id and lists.is_shared = true)
  );

-- updated_at trigger
create trigger set_list_items_updated_at
  before update on list_items
  for each row execute function set_updated_at();

-- 300-items-per-list cap
create or replace function check_list_item_cap()
returns trigger language plpgsql as $$
begin
  if (select count(*) from list_items where list_id = new.list_id) >= 300 then
    raise exception 'list item cap reached: maximum 300 items per list';
  end if;
  return new;
end;
$$;

create trigger enforce_list_item_cap
  before insert on list_items
  for each row execute function check_list_item_cap();
