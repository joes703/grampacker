import type { QueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

// current_signature is NULL when the food is incomplete (a packages entry lacks
// servings_per_package). The client treats null as "not packable".
export type FoodPackSignature = { food_item_id: string; current_signature: string | null }
export type FoodPackStateRow = { food_item_id: string; is_packed: boolean; packed_signature: string }

export async function fetchFoodPackSignatures(userId: string, listId: string): Promise<FoodPackSignature[]> {
  const { data, error } = await supabase.rpc('get_food_pack_signatures', { p_user_id: userId, p_list_id: listId })
  if (error) throw error
  return (data ?? []) as FoodPackSignature[]
}

// Owner-scoped filter is defense in depth (queries/index.ts convention).
export async function fetchFoodPackState(userId: string, listId: string): Promise<FoodPackStateRow[]> {
  const { data: plan, error: pErr } = await supabase
    .from('food_plans').select('id').eq('list_id', listId).eq('user_id', userId).maybeSingle()
  if (pErr) throw pErr
  if (!plan) return []
  const { data, error } = await supabase
    .from('food_pack_state')
    .select('food_item_id, is_packed, packed_signature')
    .eq('food_plan_id', (plan as { id: string }).id)
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? []) as FoodPackStateRow[]
}

// expectedSignature is the current_signature the user saw; the RPC rejects a missing
// or stale value (PT409) so an offline pack never packs a quantity the user never saw.
export async function setFoodPackState(
  userId: string, listId: string, foodItemId: string, isPacked: boolean, expectedSignature: string | null,
): Promise<FoodPackStateRow> {
  const { data, error } = await supabase.rpc('set_food_pack_state', {
    p_user_id: userId, p_list_id: listId, p_food_item_id: foodItemId,
    p_is_packed: isPacked, p_expected_signature: expectedSignature,
  })
  if (error) throw error
  return data as FoodPackStateRow
}

// Single source of truth for food-plan invalidation: any mutation that changes
// entries (and therefore projected quantities) must refresh BOTH the plan document
// and the packed signatures. Replaces the scattered invalidateQueries(foodPlan)
// callsites so a new mutation cannot forget the signatures key.
export function invalidateFoodPlanCaches(qc: QueryClient, listId: string): void {
  qc.invalidateQueries({ queryKey: queryKeys.foodPlan(listId) })
  qc.invalidateQueries({ queryKey: queryKeys.foodPackSignatures(listId) })
}
