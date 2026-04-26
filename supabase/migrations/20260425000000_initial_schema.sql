-- Phase 1: profiles table, RLS, and new-user trigger.
-- Run this in the Supabase SQL Editor (or via `supabase db push` once linked).
-- Auth (email, password, sessions) is handled entirely by Supabase.
-- profiles exists as an anchor for user-owned data (categories, gear, lists).

-- ============================================================
-- profiles
-- ============================================================

create table public.profiles (
  id         uuid        primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- updated_at trigger (reused by all tables that need it)
-- ============================================================

create function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ============================================================
-- new-user trigger: creates a profile row on every signup
-- ============================================================

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- RLS
-- ============================================================

alter table public.profiles enable row level security;

create policy profiles_self_select on public.profiles
  for select using (auth.uid() = id);

create policy profiles_self_update on public.profiles
  for update using (auth.uid() = id);
