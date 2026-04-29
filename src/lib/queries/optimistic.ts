import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { supabase } from '../supabase'

// ── Bulk helpers ──────────────────────────────────────────────────────────────

// Single-round-trip sort_order rewrite for any reorder flow. Uses upsert with
// onConflict: 'id' so every row in `updates` hits the UPDATE path (every id
// already exists in the table — we never insert here). Empty updates list is a
// no-op so callers don't have to guard.
type ReorderableTable = 'lists' | 'list_items' | 'categories' | 'gear_items'

export async function bulkUpdateSortOrder(
  table: ReorderableTable,
  updates: { id: string; sort_order: number }[],
): Promise<void> {
  if (updates.length === 0) return
  const { error } = await supabase.from(table).upsert(updates, { onConflict: 'id' })
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
