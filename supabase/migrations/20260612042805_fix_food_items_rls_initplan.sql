-- Wrap auth.uid() in the food_items owner policy so the planner caches it once
-- per statement (initPlan) instead of re-evaluating per row. food_items shipped
-- (20260611120000) with the bare auth.uid() form, which the auth_rls_initplan
-- advisor reports as a warning (the same warning class migration 20260512000000
-- cleared for the other owner tables). Behavior-preserving: identical predicate,
-- same FOR ALL TO authenticated single policy - only the initPlan wrapping changes.
drop policy if exists food_items_owner_all on public.food_items;
create policy food_items_owner_all on public.food_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
