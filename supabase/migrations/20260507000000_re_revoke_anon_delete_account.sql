-- Defensive re-assertion of the existing anon revoke on delete_account().
-- The original migration (20260426000000_delete_account_rpc.sql) revoked
-- EXECUTE from public/anon and granted only to authenticated. The
-- subsequent search_path hardening (20260505000000) used CREATE OR REPLACE
-- which per Postgres semantics preserves existing grants.
--
-- However, the Supabase security advisor flagged anon execute on this
-- function in a recent scan. Possible causes: a stale advisor read, a
-- grant-reset path the migration history didn't account for, or the
-- advisor checking a different privilege path. Re-asserting the revoke
-- is idempotent (a no-op if already in effect) and cheap insurance.
--
-- See SECURITY.md "Accepted linter warning" for context on the
-- companion warnings (authenticated can execute this function and
-- bulk_update_sort_order), which are accepted by design and already
-- documented.

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
