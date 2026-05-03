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
// ── Single-row optimistic CRUD ────────────────────────────────────────────────
//
// makeOptimisticInsert / makeOptimisticUpdate / makeOptimisticDelete cover
// the common useMutation lifecycle for single-row writes against a cached
// list. Mirror the reorder helper's shape — drop the spread into the
// useMutation options:
//
//   useMutation({
//     mutationFn: deleteListItem,
//     ...makeOptimisticDelete<ListItemWithGear, string>({
//       qc,
//       queryKey: queryKeys.listItems(listId),
//       id: (itemId) => itemId,
//     }),
//   })
//
// All three helpers fire `cancelQueries` without awaiting (same rationale as
// reorder — keep the cache write in the same tick as the user gesture so any
// concurrent CSS transition animates against the correct final state). The
// theoretical clobber race is rare (staleTime: 30s) and self-heals on
// settled-time invalidation.
//
// Side caches (joined / cascading) take an `invalidateKeys` array — they
// receive no optimistic write but invalidate on settled. Optimistic
// fan-out across multiple caches (e.g. updating embedded gear in every
// list-items cache) is out of scope.

type CommonOpts = {
  qc: QueryClient
  // Primary cache that receives the optimistic write.
  queryKey: QueryKey
  // Side caches to invalidate on settled (no optimistic write to these).
  // For joined/embedded data: e.g. an optimistic write to ['gear-items']
  // also invalidates ['list-items'] so any open list view picks up the
  // change after the round-trip.
  invalidateKeys?: QueryKey[]
  // If provided, shows a toast on error rollback. Omit for silent rollback
  // when the calling page surfaces errors inline (e.g. dialog with its own
  // error state). Reorder uses this because the snap-back is otherwise
  // indistinguishable from "user dragged it back themselves".
  errorToast?: string
}

type OptimisticContext<T> = { previous: T[] | undefined }

// Shared lifecycle pieces — error rollback and settled invalidation are
// identical across all three CRUD helpers.
function makeRollback<T>(opts: CommonOpts) {
  return (
    _err: unknown,
    _vars: unknown,
    ctx: OptimisticContext<T> | undefined,
  ) => {
    if (ctx?.previous) opts.qc.setQueryData(opts.queryKey, ctx.previous)
    if (opts.errorToast) showToast(opts.errorToast, { type: 'error' })
  }
}

function makeSettled(opts: CommonOpts) {
  return () => {
    opts.qc.invalidateQueries({ queryKey: opts.queryKey })
    if (opts.invalidateKeys) {
      for (const k of opts.invalidateKeys) opts.qc.invalidateQueries({ queryKey: k })
    }
  }
}

// Insert one row into the cached array. The mutationFn runs in parallel —
// when it resolves, the settled refetch replaces the temp row with the
// server row (the temp id and the server id won't match, but the refetch
// rewrites the whole array so the temp row drops out and the real row
// takes its place).
export function makeOptimisticInsert<TList extends { id: string }, TInput>(opts: CommonOpts & {
  // Build the optimistic placeholder row from the mutation input. The id
  // should be a client-generated temp id (e.g. crypto.randomUUID()) — the
  // settled refetch replaces it with the server row. Other fields should
  // match what the server will return so the UI doesn't flash on settle.
  optimistic: (input: TInput) => TList
  // How the new row joins the array. Default: append. Correct for every
  // sort_order-asc cache in this app since the optimistic row's
  // sort_order is set to the current array length.
  merge?: (current: TList[], next: TList) => TList[]
}) {
  const { qc, queryKey, optimistic, merge } = opts
  return {
    onMutate: (input: TInput): OptimisticContext<TList> => {
      qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<TList[]>(queryKey)
      const next = optimistic(input)
      qc.setQueryData<TList[]>(queryKey, (curr) => {
        const arr = curr ?? []
        return merge ? merge(arr, next) : [...arr, next]
      })
      return { previous }
    },
    onError: makeRollback<TList>(opts),
    onSettled: makeSettled(opts),
  }
}

// Update one row in place. `id` resolves the row to mutate from input;
// `apply` returns the next state given (item, input). Patch-style updates
// look like `apply: (item, { patch }) => ({ ...item, ...patch })`.
export function makeOptimisticUpdate<TList extends { id: string }, TInput>(opts: CommonOpts & {
  id: (input: TInput) => string
  apply: (item: TList, input: TInput) => TList
}) {
  const { qc, queryKey, id, apply } = opts
  return {
    onMutate: (input: TInput): OptimisticContext<TList> => {
      qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<TList[]>(queryKey)
      const targetId = id(input)
      qc.setQueryData<TList[]>(queryKey, (curr) => {
        if (!curr) return curr
        return curr.map((item) => (item.id === targetId ? apply(item, input) : item))
      })
      return { previous }
    },
    onError: makeRollback<TList>(opts),
    onSettled: makeSettled(opts),
  }
}

// Remove one row from the cached array. `id` resolves the row to remove
// from input.
export function makeOptimisticDelete<TList extends { id: string }, TInput>(opts: CommonOpts & {
  id: (input: TInput) => string
}) {
  const { qc, queryKey, id } = opts
  return {
    onMutate: (input: TInput): OptimisticContext<TList> => {
      qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<TList[]>(queryKey)
      const targetId = id(input)
      qc.setQueryData<TList[]>(queryKey, (curr) => {
        if (!curr) return curr
        return curr.filter((item) => item.id !== targetId)
      })
      return { previous }
    },
    onError: makeRollback<TList>(opts),
    onSettled: makeSettled(opts),
  }
}

// ── Reorder mutation lifecycle ────────────────────────────────────────────────

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
