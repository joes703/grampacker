import { supabase } from '../supabase'
import type { TargetDefault, DailyDefaultUpsert, DailyTargetMetric } from '../types'

// Owner-scoped read. The explicit user_id filter is defense in depth on top of
// RLS (see the barrel header on the cross-channel-leak defense).
export async function fetchTargetDefaults(userId: string): Promise<TargetDefault[]> {
  const { data, error } = await supabase
    .from('food_plan_target_defaults').select('*').eq('user_id', userId)
  if (error) throw error
  return (data ?? []) as TargetDefault[]
}

// Atomic editor save: active rows upserted, Off metrics deleted, in one txn.
export type DefaultsSavePayload = { upserts: DailyDefaultUpsert[]; deletes: DailyTargetMetric[] }

export async function saveTargetDefaults(userId: string, payload: DefaultsSavePayload): Promise<void> {
  const { error } = await supabase.rpc('save_target_defaults', {
    p_user_id: userId, p_upserts: payload.upserts, p_deletes: payload.deletes,
  })
  if (error) throw error
}
