-- Aligns delete_account()'s search_path with the documented hardening
-- pattern (public, pg_temp). The original migration set just `public`,
-- which the function-hardening migration (20260429000000) corrected on
-- every other SECURITY DEFINER function but missed this one. The function
-- body uses fully-qualified auth.users and the built-in auth.uid(), so
-- this is closing a documentation/code drift, not patching an active
-- vulnerability. See SECURITY.md "SECURITY DEFINER functions".
--
-- create or replace preserves the existing EXECUTE grants set in
-- 20260426000000_delete_account_rpc.sql (revoked from public/anon,
-- granted to authenticated).

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
