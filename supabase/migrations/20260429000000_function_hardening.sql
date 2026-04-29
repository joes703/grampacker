-- Hardens Postgres functions against search_path-based attacks and
-- locks down SECURITY DEFINER functions so they're not REST-callable
-- as RPCs by anon/authenticated. Addresses Supabase database linter
-- findings: function_search_path_mutable + role_grant_security_definer.
--
-- All six functions touched here are trigger-only (regular triggers
-- or event triggers) — no app code calls them as RPCs, so removing
-- PUBLIC EXECUTE is safe. Triggers fire inside the database engine
-- and don't go through the REST EXECUTE permission path.
--
-- This migration also backfills public.rls_auto_enable + its event
-- trigger ensure_rls, which existed in prod but had no migration
-- record. Definition captured from pg_get_functiondef on the live DB.

-- ============================================================
-- 1. Pin search_path on the four SECURITY INVOKER trigger functions
-- ============================================================
-- Defense-in-depth: function behavior should not depend on the
-- caller's search_path. `pg_temp` last so a malicious temp-schema
-- shadow can't intercept unqualified references.

alter function public.set_updated_at()
  set search_path = public, pg_temp;

alter function public.check_gear_item_limit()
  set search_path = public, pg_temp;

alter function public.check_list_cap()
  set search_path = public, pg_temp;

alter function public.check_list_item_cap()
  set search_path = public, pg_temp;

-- ============================================================
-- 2. Lock down handle_new_user (SECURITY DEFINER, trigger-only)
-- ============================================================
-- Already had `set search_path = public`; tightening to include
-- pg_temp matches the linter's expectation. Revoking EXECUTE from
-- PUBLIC + anon + authenticated stops the function from being
-- callable as a REST RPC. The on_auth_user_created trigger on
-- auth.users continues to fire — triggers don't consult EXECUTE
-- privileges.

alter function public.handle_new_user()
  set search_path = public, pg_temp;

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;

-- ============================================================
-- 3. Backfill rls_auto_enable + ensure_rls event trigger, lock down
-- ============================================================
-- Defensive event trigger: auto-enables RLS on any newly created
-- public-schema table. Was installed in prod outside the migration
-- trail (likely from a Supabase hardening template), so this section
-- backfills the file system to match the live schema.
--
-- search_path is intentionally pinned to 'pg_catalog' (not public,
-- pg_temp): the body calls pg_event_trigger_ddl_commands() and
-- format(), both of which live in pg_catalog. Changing this would
-- break the trigger.
--
-- Order: CREATE OR REPLACE function first, then DROP+CREATE the
-- event trigger. Migrations run inside a transaction so the
-- DROP/CREATE pair is atomic — no window where ensure_rls is
-- missing while a concurrent CREATE TABLE could slip through.

-- NOTE: function body below is intentionally preserved verbatim from
-- pg_get_functiondef on the live DB (UPPERCASE keywords), diverging
-- from the lowercase convention used elsewhere in this folder. This
-- keeps future "did the live function drift from migration?" diffs
-- byte-clean — Postgres is case-insensitive on keywords, so behavior
-- is identical.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

drop event trigger if exists ensure_rls;

create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();

revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;