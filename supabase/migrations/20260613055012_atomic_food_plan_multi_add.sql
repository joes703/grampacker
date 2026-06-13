-- Add the same food to multiple plan locations in one transaction.
--
-- Each item delegates to the concurrency-safe single-entry RPC. PostgreSQL
-- executes the entire function call as one transaction, so any late failure
-- rolls back every earlier insert or merge in the batch.
create or replace function public.upsert_food_plan_entries(
  p_user_id uuid,
  p_additions jsonb
)
returns setof public.food_plan_entries
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_addition jsonb;
  v_result public.food_plan_entries;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if jsonb_typeof(p_additions) is distinct from 'array' then
    raise exception 'additions must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_additions) < 1
     or jsonb_array_length(p_additions) > 60 then
    raise exception 'additions must contain between 1 and 60 entries'
      using errcode = '22023';
  end if;

  for v_addition in
    select value from jsonb_array_elements(p_additions)
  loop
    select *
      into v_result
      from public.upsert_food_plan_entry(
        p_user_id,
        v_addition->'entry',
        nullif(v_addition->>'preserve_basis', ''),
        null
      );
    return next v_result;
  end loop;

  return;
end;
$$;

revoke execute on function public.upsert_food_plan_entries(uuid, jsonb)
  from public, anon;
grant execute on function public.upsert_food_plan_entries(uuid, jsonb)
  to authenticated;
