-- Adds the missing WITH CHECK clause to profiles_self_update so it
-- matches the pattern used by every other UPDATE-allowing policy in
-- the codebase. The USING clause restricts which rows the user can
-- target; WITH CHECK restricts what those rows can become.
--
-- In practice the absence is benign — profiles.id is a primary key
-- referencing auth.users(id), so any attempt to update id to another
-- value fails on FK/PK before RLS comes into it, and the only other
-- mutable column (updated_at) isn't user-meaningful. The fix is
-- pattern consistency, not a vulnerability close. Codex audit
-- finding 8.

drop policy profiles_self_update on public.profiles;

create policy profiles_self_update on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
