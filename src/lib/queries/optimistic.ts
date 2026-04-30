import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { supabase } from '../supabase'

// ── Bulk helpers ──────────────────────────────────────────────────────────────

// Single-round-trip sort_order rewrite. Calls a SECURITY DEFINER RPC that
// runs UPDATE … SET sort_order against a whitelisted table. Sidesteps the
// PostgREST upsert path entirely — no INSERT … ON CONFLICT, no RLS WITH
// CHECK against a partial row, no NOT NULL trap. See migration
// 20260430000000_bulk_reorder_rpc.sql for the SQL definition and the trust
// assumption (callers can only know an id by first reading it, and SELECT
// RLS gates that, so the function doesn't re-verify ownership).
//
// The TS-side union matches the SQL function's table whitelist — keeps
// misuse a compile error rather than a runtime exception.
type ReorderableTable = 'categories' | 'list_items'

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

// ── Reorder mutation lifecycle ────────────────────────────────────────────────

// Canonical optimistic-update lifecycle for any reorder mutation that takes
// `{id, sort_order}[]`. Handles cancel → snapshot → optimistic write → roll
// back on error → settle (invalidate). Drop into a useMutation alongside its
// mutationFn:
//
//   useMutation({
//     mutationFn: reorderCategories,
//     ...makeOptimisticReorder<Category>(qc, queryKeys.categories()),
//   })
//
// The cached array gets each affected item's sort_order rewritten in place
// and is then re-sorted by sort_order so the visual order matches.
//
// IMPORTANT: `updates` must be a permutation of an existing subset of the
// cached rows — i.e. every id in `updates` must already exist in the cache,
// and the sort_order values must be a permutation of those rows' existing
// sort_order values. Passing a partial subset with arbitrary values can
// silently corrupt the cache: rows you didn't touch keep their old
// sort_order, the merged + sorted result then puts them in surprising
// positions, and the optimistic state diverges from the eventual server
// truth until the next refetch. `assignSortOrderSlots` (in grouping.ts) is
// the canonical way to build a safe `updates` array.
export function makeOptimisticReorder<T extends { id: string; sort_order: number }>(
  qc: QueryClient,
  queryKey: QueryKey,
) {
  return {
    onMutate: async (updates: { id: string; sort_order: number }[]) => {
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<T[]>(queryKey)
      const byId = new Map(updates.map((u) => [u.id, u.sort_order]))
      qc.setQueryData<T[]>(queryKey, (curr) => {
        if (!curr) return curr
        return curr
          .map((item) => (byId.has(item.id) ? { ...item, sort_order: byId.get(item.id)! } : item))
          .sort((a, b) => a.sort_order - b.sort_order)
      })
      return { previous }
    },
    onError: (
      _err: unknown,
      _vars: unknown,
      ctx: { previous: T[] | undefined } | undefined,
    ) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey })
    },
  }
}
