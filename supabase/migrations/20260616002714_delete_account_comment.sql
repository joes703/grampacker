-- Forward-only: correct the delete_account() function comment to enumerate the
-- data the FK ON DELETE CASCADE transitively removes. The function body is
-- unchanged and lives in 20260426000000_delete_account_rpc.sql (immutable).
comment on function public.delete_account() is
  'Deletes the calling user''s auth.users row (auth.uid()). FK ON DELETE CASCADE '
  'then transitively removes the profiles row and ALL owned data: lists, '
  'list_items, categories, gear_items, and every food table - food_items, '
  'food_plans, meals, food_plan_days, day_meals, food_plan_entries, '
  'food_plan_daily_targets, meal_targets, food_plan_target_defaults, '
  'food_pack_state. Cascade verified by supabase/tests/delete_account_cascade.test.sql.';
