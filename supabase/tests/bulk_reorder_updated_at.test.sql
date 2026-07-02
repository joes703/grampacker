-- supabase/tests/bulk_reorder_updated_at.test.sql
--
-- Reorder-only writes must NOT bump updated_at - the "/lists Updated just now"
-- regression fixed in migration 20260524140830_sort_order_no_op_preserves_updated_at.
-- Two defense-in-depth layers are under test:
--   1. bulk_update_sort_order skips rows whose sort_order is already correct
--      (`... and <table>.sort_order is distinct from data.sort_order`), so a
--      no-op reorder issues no UPDATE at all.
--   2. set_updated_at preserves OLD.updated_at whenever the only difference is
--      sort_order (it compares to_jsonb(NEW)/to_jsonb(OLD) with updated_at and
--      sort_order stripped), so even a genuine reorder that DOES write the row
--      keeps the timestamp.
--
-- Why this lives in pgTAP: the contract previously had coverage ONLY in the
-- env-gated Vitest integration file (src/lib/queries.bulk-reorder.test.ts,
-- `describe.skip` unless TEST_USER_* is set), which runs in no CI loop. This
-- suite is its CI home (DB Tests).
--
-- Determinism: now() is constant within a transaction, so a "bump" would set
-- updated_at to the same instant an INSERT default would, making preserve and
-- bump indistinguishable. The set_updated_at triggers are BEFORE UPDATE only
-- (lists/list_items/gear_items), so we seed each row with an explicit PAST
-- updated_at that survives INSERT; a later bump moves it to now() (today),
-- which is never equal to the seeded 2020 instant. categories has no updated_at
-- column and is intentionally excluded.

begin;
select plan(13);

create extension if not exists pgtap with schema extensions;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'reorder-owner@test.dev')
on conflict (id) do nothing;

-- Seed two rows per reorderable table that carries updated_at, each pinned to
-- the same past instant. slug must be exactly 6 chars (lists_slug_length).
insert into public.lists (id, user_id, name, slug, sort_order, updated_at) values
  ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', 'List A', 'rdrla1', 0, timestamptz '2020-01-01 00:00:00+00'),
  ('11111111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000d1', 'List B', 'rdrlb2', 1, timestamptz '2020-01-01 00:00:00+00');

insert into public.gear_items (id, user_id, name, weight_grams, sort_order, updated_at) values
  ('22222222-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', 'Gear A', 100, 0, timestamptz '2020-01-01 00:00:00+00'),
  ('22222222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000d1', 'Gear B', 200, 1, timestamptz '2020-01-01 00:00:00+00');

insert into public.list_items (id, user_id, list_id, gear_item_id, quantity, sort_order, updated_at) values
  ('33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 1, 0, timestamptz '2020-01-01 00:00:00+00'),
  ('33333333-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000d1', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 1, 1, timestamptz '2020-01-01 00:00:00+00');

-- Sanity: the seeded updated_at really is the past instant (no BEFORE INSERT
-- trigger clobbered it), so every preserve assertion below is meaningful.
select is(
  (select updated_at from public.lists where id = '11111111-0000-0000-0000-000000000001'),
  timestamptz '2020-01-01 00:00:00+00',
  'seed: lists.updated_at starts at the past instant (no insert-time bump)');

-- The RPC is SECURITY INVOKER, so exercise it as the owning authenticated user.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

-- ============================================================
-- Layers 1+2 through the RPC: a genuine reorder preserves updated_at
-- ============================================================
-- Swap the two lists' sort_order. Both rows are genuinely rewritten, so the
-- BEFORE UPDATE trigger fires on both and must preserve updated_at.
select lives_ok($$
  select public.bulk_update_sort_order(
    'lists',
    array['11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002']::uuid[],
    array[1,0]::int[])
$$, 'bulk_update_sort_order(lists) runs for the owner');

select is(
  (select sort_order from public.lists where id = '11111111-0000-0000-0000-000000000001'),
  1, 'lists: sort_order actually changed (the reorder really happened)');

select is(
  (select count(*)::int from public.lists
     where id in ('11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002')
       and updated_at = timestamptz '2020-01-01 00:00:00+00'),
  2, 'lists: a reorder preserves updated_at on every reordered row');

select lives_ok($$
  select public.bulk_update_sort_order(
    'gear_items',
    array['22222222-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000002']::uuid[],
    array[1,0]::int[])
$$, 'bulk_update_sort_order(gear_items) runs for the owner');

select is(
  (select count(*)::int from public.gear_items
     where id in ('22222222-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000002')
       and updated_at = timestamptz '2020-01-01 00:00:00+00'),
  2, 'gear_items: a reorder preserves updated_at on every reordered row');

select lives_ok($$
  select public.bulk_update_sort_order(
    'list_items',
    array['33333333-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000002']::uuid[],
    array[1,0]::int[])
$$, 'bulk_update_sort_order(list_items) runs for the owner');

select is(
  (select count(*)::int from public.list_items
     where id in ('33333333-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000002')
       and updated_at = timestamptz '2020-01-01 00:00:00+00'),
  2, 'list_items: a reorder preserves updated_at on every reordered row');

-- The RPC only writes sort_order, so untouched columns survive a reorder.
select is(
  (select name from public.lists where id = '11111111-0000-0000-0000-000000000001'),
  'List A', 'lists: a reorder leaves non-sort_order columns intact');

-- ============================================================
-- Layer 2 directly: a non-RPC sort_order-only UPDATE preserves updated_at
-- ============================================================
-- Guards the trigger independently of the RPC, so a future write path that
-- touches only sort_order cannot reintroduce the bug.
update public.lists set sort_order = 9
  where id = '11111111-0000-0000-0000-000000000002';
select is(
  (select updated_at from public.lists where id = '11111111-0000-0000-0000-000000000002'),
  timestamptz '2020-01-01 00:00:00+00',
  'trigger: a direct sort_order-only UPDATE preserves updated_at');

-- ============================================================
-- Non-vacuity: a real content edit DOES bump updated_at
-- ============================================================
-- Proves the preserve assertions above are meaningful (the timestamp CAN move).
update public.lists set name = 'List A renamed'
  where id = '11111111-0000-0000-0000-000000000001';
select isnt(
  (select updated_at from public.lists where id = '11111111-0000-0000-0000-000000000001'),
  timestamptz '2020-01-01 00:00:00+00',
  'trigger: a content edit (name) bumps updated_at off the past instant');
select ok(
  (select updated_at from public.lists where id = '11111111-0000-0000-0000-000000000001')
    > timestamptz '2020-01-01 00:00:00+00',
  'trigger: the bumped updated_at moves forward to now()');

-- A content edit bundled WITH a sort_order change still bumps: sort_order is
-- stripped from the diff, but the name change is not.
update public.gear_items set name = 'Gear A renamed', sort_order = 7
  where id = '22222222-0000-0000-0000-000000000001';
select isnt(
  (select updated_at from public.gear_items where id = '22222222-0000-0000-0000-000000000001'),
  timestamptz '2020-01-01 00:00:00+00',
  'trigger: a content edit bundled with a sort_order change still bumps');

select finish();
rollback;
