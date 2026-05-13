-- Normalize Data API table privileges.
--
-- 20260514000000_explicit_data_api_table_grants.sql added the intended
-- grants but did not remove the historical broad defaults that older
-- Supabase projects ship with. The verification query showed legacy
-- grants still present on the API roles and on the `public` pseudo-role:
--   - anon with INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES on the
--     four content tables.
--   - anon with grants on profiles at all (should be none).
--   - authenticated with TRUNCATE/TRIGGER/REFERENCES on every table and
--     INSERT/DELETE on profiles.
-- RLS was still containing the blast radius, but the table-level grant
-- surface was wider than this app actually uses. Narrow it.
--
-- Approach
-- --------
-- 1. REVOKE ALL PRIVILEGES from `public`, `anon`, `authenticated`, and
--    `service_role` on each of the five tables. This wipes both the
--    legacy broad defaults and the narrower grants from the prior
--    migration. Idempotent: REVOKE on a privilege that isn't held is a
--    no-op.
-- 2. Re-grant exactly the Data API matrix this app needs. Identical to
--    the grants in 20260514000000, repeated here so this migration is
--    self-contained and the file reads as a single normalization step.
--
-- Reachability vs. authorization (unchanged from the prior migration)
-- -------------------------------------------------------------------
-- GRANT controls Data API reachability; RLS still gates which rows are
-- visible. No RLS policies change in this migration. Granting only
-- SELECT to anon on the four content tables matches the
-- *_anon_select policies installed in 20260512000000 — anon can read
-- only rows whose lists are shared.
--
-- Why no TRUNCATE, TRIGGER, or REFERENCES
-- ---------------------------------------
-- The app never truncates tables (delete_account() uses DELETE), never
-- creates triggers from the Data API, and never adds FK references
-- from API roles. These privileges were vestigial defaults.

-- ============================================================
-- Wipe the broad legacy grants (and the prior migration's grants).
-- ============================================================

revoke all privileges
  on table public.profiles,
           public.categories,
           public.gear_items,
           public.lists,
           public.list_items
  from public, anon, authenticated, service_role;

-- ============================================================
-- Re-grant exactly the Data API matrix this app needs.
-- ============================================================

-- profiles: authenticated reads + updates its own row through RLS.
-- INSERTs come from the SECURITY DEFINER handle_new_user() trigger;
-- DELETEs come from the SECURITY DEFINER delete_account() function.
-- No anon access.
grant select, update
  on table public.profiles
  to authenticated;

grant select, insert, update, delete
  on table public.profiles
  to service_role;

-- Content tables: anon needs SELECT for /r/<slug> share pages
-- (rows filtered by the *_anon_select policies). Authenticated owns
-- its rows through owner-keyed policies. service_role is full DML for
-- admin / server tasks.
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
-- The same query from 20260514000000. Expected result: 42 rows
-- (one row per (table, grantee, privilege_type) triple — the
-- information_schema view unpivots privileges), no TRUNCATE /
-- TRIGGER / REFERENCES present, no row with table_name = 'profiles'
-- and grantee = 'anon'.
--
-- Row math: profiles contributes 2 (authenticated SELECT/UPDATE) + 4
-- (service_role SELECT/INSERT/UPDATE/DELETE) = 6. Each of the four
-- content tables contributes 1 (anon SELECT) + 4 (authenticated) +
-- 4 (service_role) = 9, for 36. Total 6 + 36 = 42. If the filter
-- drops service_role, expected is 22.
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
-- To confirm no grants leaked to `public`, run the same query with
--   and grantee = 'public'
-- The expected result is zero rows for these five tables.
