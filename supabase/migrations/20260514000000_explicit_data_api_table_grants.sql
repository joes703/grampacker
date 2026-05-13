-- Explicit Data API table grants.
--
-- Supabase is removing the implicit "all public-schema tables are exposed
-- to the Data API" default. The new defaults take effect for new projects
-- on 2026-05-30 and for existing projects on 2026-10-30. Existing tables
-- keep their current behavior until then, but the safe play is to make
-- the grants explicit now so the cut-over is a no-op for this project.
--
-- Reachability vs. authorization
-- ------------------------------
-- These statements grant TABLE privileges. They control whether the
-- PostgREST role can address the table through the Data API at all. They
-- do not grant row visibility on their own:
--
--   GRANT      = role can reach the table via the Data API.
--   RLS policy = role can see / write specific rows.
--
-- RLS is still the security boundary. Adding these GRANTs does not turn
-- any private row into a public row; every existing policy continues to
-- gate visibility per role. The advisor-cleanup migration
-- (20260512000000_advisor_cleanup_rls_policies.sql) already enumerates
-- the per-(role, action) policies that match the grants below.
--
-- Per-role rationale
-- ------------------
--   profiles
--     authenticated: select + update only. Profile rows are inserted by
--       the SECURITY DEFINER trigger handle_new_user() (EXECUTE revoked
--       from authenticated in 20260429000000) and deleted by the
--       SECURITY DEFINER function delete_account(). The role itself
--       never needs INSERT or DELETE on profiles, and no RLS policy
--       authorizes them.
--     anon: no grants. Profiles are private account rows; no
--       public-share predicate ever references this table.
--     service_role: full DML for admin / server tasks.
--
--   categories, gear_items, lists, list_items
--     authenticated: full DML. Owner-keyed RLS gates rows.
--     anon: select only. The four *_anon_select policies on these
--       tables expose rows belonging to shared lists (is_shared = true)
--       so /r/<slug> public share pages can render.
--     service_role: full DML for admin / server tasks.

-- ============================================================
-- profiles
-- ============================================================

grant select, update
  on table public.profiles
  to authenticated;

grant select, insert, update, delete
  on table public.profiles
  to service_role;

-- ============================================================
-- categories, gear_items, lists, list_items
-- ============================================================

grant select
  on table public.categories,
           public.gear_items,
           public.lists,
           public.list_items
  to anon;

grant select, insert, update, delete
  on table public.categories,
           public.gear_items,
           public.lists,
           public.list_items
  to authenticated;

grant select, insert, update, delete
  on table public.categories,
           public.gear_items,
           public.lists,
           public.list_items
  to service_role;

-- ============================================================
-- Verification (run manually after applying)
-- ============================================================
--
--   select
--     grantee,
--     table_name,
--     privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public'
--     and table_name in ('profiles', 'categories', 'gear_items', 'lists', 'list_items')
--     and grantee in ('anon', 'authenticated', 'service_role')
--   order by table_name, grantee, privilege_type;
--
-- Expected matrix:
--   profiles      anon            (none)
--   profiles      authenticated   SELECT, UPDATE
--   profiles      service_role    SELECT, INSERT, UPDATE, DELETE
--   categories    anon            SELECT
--   categories    authenticated   SELECT, INSERT, UPDATE, DELETE
--   categories    service_role    SELECT, INSERT, UPDATE, DELETE
--   gear_items    anon            SELECT
--   gear_items    authenticated   SELECT, INSERT, UPDATE, DELETE
--   gear_items    service_role    SELECT, INSERT, UPDATE, DELETE
--   lists         anon            SELECT
--   lists         authenticated   SELECT, INSERT, UPDATE, DELETE
--   lists         service_role    SELECT, INSERT, UPDATE, DELETE
--   list_items    anon            SELECT
--   list_items    authenticated   SELECT, INSERT, UPDATE, DELETE
--   list_items    service_role    SELECT, INSERT, UPDATE, DELETE
--
-- Post-deploy smoke (use the app, not psql):
--   1. Signed-in: /gear and /lists load, item CRUD round-trips.
--   2. Logged-out: /r/<slug> for a shared list renders names + weights.
--   3. Logged-out: /r/<slug> for a non-shared list returns the same
--      empty / not-found shape as before the migration.
