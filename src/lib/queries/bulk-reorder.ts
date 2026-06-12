import { supabase } from '../supabase'

// ── Bulk sort_order helper ────────────────────────────────────────────────────

// Single-round-trip sort_order rewrite. Calls a SECURITY INVOKER RPC
// that runs UPDATE ... SET sort_order against a whitelisted table.
// Sidesteps the PostgREST upsert path entirely: no INSERT ... ON
// CONFLICT, no RLS WITH CHECK against a partial row, no NOT NULL trap.
// Ownership is enforced by inline auth.uid() filters per branch
// (categories, gear_items, and lists filter on user_id = auth.uid();
// list_items joins lists and filters on lists.user_id = auth.uid())
// AND by the table's RLS auth_update policy that the invoker runs
// under. See migrations:
//   20260430000000_bulk_reorder_rpc.sql           (function shape)
//   20260501000000_bulk_reorder_rpc_ownership_check.sql (inline check)
//   20260502000000_add_gear_items_to_bulk_reorder.sql   (gear_items)
//   20260503000000_add_lists_to_bulk_reorder.sql        (lists)
//   20260514202025_reduce_security_definer.sql    (DEFINER -> INVOKER)
//   20260524140830_sort_order_no_op_preserves_updated_at.sql
//                                                 (no-op filter +
//                                                  sort_order-aware
//                                                  set_updated_at)
//
// The TS-side union matches the SQL function's table whitelist. That keeps
// misuse a compile error rather than a runtime exception.
//
// This helper lives in its own module so the pure optimistic cache
// helpers in ./optimistic.ts can stay free of any Supabase import. That
// keeps optimistic.test.ts runnable without VITE_SUPABASE_* env vars and
// avoids Vite's "ineffective dynamic import" warning that the previous
// in-helper `await import('../supabase')` produced.
export type ReorderableTable =
  | 'categories' | 'list_items' | 'gear_items' | 'lists'
  | 'food_items' | 'food_plan_days' | 'meals' | 'food_plan_entries'

export async function bulkUpdateSortOrder<T extends { id: string; sort_order: number }>(
  table: ReorderableTable,
  updates: T[],
): Promise<void> {
  if (updates.length === 0) return
  const { error } = await supabase.rpc('bulk_update_sort_order', {
    p_table: table,
    p_ids: updates.map((u) => u.id),
    p_orders: updates.map((u) => u.sort_order),
  })
  if (error) throw error
}
