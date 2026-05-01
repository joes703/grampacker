import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { showToast } from '../toast'

// ── Bulk helpers ──────────────────────────────────────────────────────────────

// Single-round-trip sort_order rewrite. Calls a SECURITY DEFINER RPC that
// runs UPDATE … SET sort_order against a whitelisted table. Sidesteps the
// PostgREST upsert path entirely — no INSERT … ON CONFLICT, no RLS WITH
// CHECK against a partial row, no NOT NULL trap. The function enforces
// ownership inline per table — categories, gear_items, and lists filter
// on user_id = auth.uid(); list_items join lists and filter on
// lists.user_id = auth.uid(). See migrations
// 20260430000000_bulk_reorder_rpc.sql (function shape),
// 20260501000000_bulk_reorder_rpc_ownership_check.sql (ownership check),
// 20260502000000_add_gear_items_to_bulk_reorder.sql (gear_items branch),
// and 20260503000000_add_lists_to_bulk_reorder.sql (lists branch).
//
// The TS-side union matches the SQL function's table whitelist — keeps
// misuse a compile error rather than a runtime exception.
type ReorderableTable = 'categories' | 'list_items' | 'gear_items' | 'lists'

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
//
// Why onMutate is sync (NOT `async` + `await qc.cancelQueries`):
//   The TanStack Query canonical optimistic pattern awaits cancelQueries
//   before setQueryData so an in-flight refetch can't clobber the
//   optimistic state. We diverge: this hook fires reorder mutations from
//   dnd-kit's onDragEnd, and dnd-kit starts a CSS drop transition on the
//   sortable rows in the SAME synchronous tick that onDragEnd returns.
//   That transition animates each row's transform back to identity. If
//   the cache update happens one microtask later (which an `await` forces),
//   the transition animates against the still-original DOM order — the
//   dropped row visibly snaps to its starting position before a later
//   re-render jumps it to the correct new position.
//
//   Fix: fire cancelQueries without awaiting and call setQueryData in the
//   same tick. The drop transition then animates against the correct final
//   order from the start.
//
//   The cancel still happens — it's just fire-and-forget. The theoretical
//   race (an in-flight refetch resolves between our setQueryData and the
//   cancel taking effect, overwriting the optimistic state with stale
//   server truth) is rare in practice (the app uses staleTime: 30s, so
//   most reorders have no in-flight fetch) and self-healing (onSettled
//   below invalidates the key and triggers a fresh fetch regardless).
export function makeOptimisticReorder<T extends { id: string; sort_order: number }>(
  qc: QueryClient,
  queryKey: QueryKey,
) {
  return {
    onMutate: (updates: { id: string; sort_order: number }[]) => {
      qc.cancelQueries({ queryKey })
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
      // The rollback is otherwise silent — items just snap back to their
      // original positions. Without a toast, users on a flaky connection
      // can't distinguish "save failed" from "I dragged it back myself".
      showToast("Couldn't save the new order. Please try again.", { type: 'error' })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey })
    },
  }
}
