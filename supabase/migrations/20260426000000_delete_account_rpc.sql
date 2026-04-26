-- Allow a logged-in user to permanently delete their own account.
-- All user-owned rows (profiles, categories, gear_items, lists, list_items)
-- have ON DELETE CASCADE foreign keys to auth.users, so this also wipes their data.

create or replace function delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function delete_account() from public, anon;
grant execute on function delete_account() to authenticated;
