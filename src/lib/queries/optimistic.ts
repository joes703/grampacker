import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { showToast } from '../toast'

// This module holds only the pure TanStack Query cache lifecycle helpers
// (insert / update / delete / bulk delete / bulk move / reorder). It must
// stay free of any Supabase import so optimistic.test.ts can evaluate
// the module without VITE_SUPABASE_* env vars. The Supabase-side RPC
// helper for sort_order writes lives next door in ./bulk-reorder.ts.

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
// cached rows. Every id in `updates` must already exist in the cache, and
// the sort_order values must be a permutation of those rows' existing
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
//   the transition animates against the still-original DOM order. The
//   dropped row visibly snaps to its starting position before a later
//   re-render jumps it to the correct new position.
//
//   Fix: fire cancelQueries without awaiting and call setQueryData in the
//   same tick. The drop transition then animates against the correct final
//   order from the start.
//
//   The cancel still happens; it's just fire-and-forget. The theoretical
//   race (an in-flight refetch resolves between our setQueryData and the
//   cancel taking effect, overwriting the optimistic state with stale
//   server truth) is rare in practice (the app uses staleTime: 30s, so
//   most reorders have no in-flight fetch) and self-healing (onSettled
//   below invalidates the key and triggers a fresh fetch regardless).
// ── Single-row optimistic CRUD ────────────────────────────────────────────────
//
// makeOptimisticInsert / makeOptimisticUpdate / makeOptimisticDelete cover
// the common useMutation lifecycle for single-row writes against a cached
// list. Mirror the reorder helper's shape. Drop the spread into the
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
// reorder: keep the cache write in the same tick as the user gesture so any
// concurrent CSS transition animates against the correct final state). The
// theoretical clobber race is rare (staleTime: 30s) and self-heals on
// settled-time invalidation.
//
// Side caches (joined / cascading) take an `invalidateKeys` array. They
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

// Shared lifecycle pieces. Error rollback and settled invalidation are
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

// Insert one row into the cached array. The mutationFn runs in parallel;
// when it resolves, the settled refetch replaces the temp row with the
// server row (the temp id and the server id won't match, but the refetch
// rewrites the whole array so the temp row drops out and the real row
// takes its place).
export function makeOptimisticInsert<TList extends { id: string }, TInput>(opts: CommonOpts & {
  // Build the optimistic placeholder row from the mutation input. The id
  // should be a client-generated temp id (e.g. crypto.randomUUID()). The
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

// Remove every row whose id matches `ids(input)` from the cached array.
// Mirrors makeOptimisticDelete but for a set of ids in one mutation. Used
// for multi-select bulk delete (e.g. "Delete (12)" on the gear page).
export function makeOptimisticBulkDelete<TList extends { id: string }, TInput>(opts: CommonOpts & {
  ids: (input: TInput) => string[]
}) {
  const { qc, queryKey, ids } = opts
  return {
    onMutate: (input: TInput): OptimisticContext<TList> => {
      qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<TList[]>(queryKey)
      const targetIds = new Set(ids(input))
      if (targetIds.size === 0) return { previous }
      qc.setQueryData<TList[]>(queryKey, (curr) => {
        if (!curr) return curr
        return curr.filter((item) => !targetIds.has(item.id))
      })
      return { previous }
    },
    onError: makeRollback<TList>(opts),
    onSettled: makeSettled(opts),
  }
}

// Apply a patch to every row whose id matches `ids(input)`. Used for
// multi-select bulk moves (e.g. "Move 12 items to Kitchen" on the gear
// page). Mirrors makeOptimisticBulkDelete but writes via apply() instead
// of filter, so the caller controls how the patch composes with each row.
// That matters for nested fields like an embedded gear_item.category_id.
export function makeOptimisticBulkMove<TList extends { id: string }, TInput>(opts: CommonOpts & {
  ids: (input: TInput) => string[]
  apply: (item: TList, input: TInput) => TList
}) {
  const { qc, queryKey, ids, apply } = opts
  return {
    onMutate: (input: TInput): OptimisticContext<TList> => {
      qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<TList[]>(queryKey)
      const targetIds = new Set(ids(input))
      if (targetIds.size === 0) return { previous }
      qc.setQueryData<TList[]>(queryKey, (curr) => {
        if (!curr) return curr
        return curr.map((item) => (targetIds.has(item.id) ? apply(item, input) : item))
      })
      return { previous }
    },
    onError: makeRollback<TList>(opts),
    onSettled: makeSettled(opts),
  }
}

// ── Reorder mutation lifecycle ────────────────────────────────────────────────

// Dev-only invariant check on the reorder payload. The helper accepts
// SUBSET permutations (only the dragged category's rows for /lists/:id
// within-category DnD), so we explicitly do NOT require the payload to
// cover every cached row. What we do require:
//
//   1. No duplicate ids in the payload. A duplicate silently overwrites
//      itself in the byId map (last write wins) and the first write is
//      lost; the resulting cache state isn't a permutation of any valid
//      server state.
//   2. Every payload id must exist in the cache. An unknown id (typo,
//      stale snapshot, wrong cache key) silently no-ops in the current
//      map-and-spread code: cached rows keep their original sort_order
//      and the visual order ends up wrong but the helper can't see it.
//   3. The payload's sort_order multiset must equal the touched cache
//      subset's existing sort_order multiset. This is the "permutation
//      of an existing subset" invariant documented above: passing
//      "arbitrary values" instead of a valid permutation corrupts the
//      cache until the next refetch.
//
// Note on the spec language "no cached item omitted": that would block
// the legitimate within-category DnD path, where the dragged category's
// items are reordered while other categories' items stay in their slots.
// `assignSortOrderSlots()` in grouping.ts is the canonical builder for
// these subset payloads — by construction it returns a permutation of
// the input subset's sort_orders, so the multiset check above is the
// invariant the helper actually needs.
//
// Throw (not warn): a bad payload is always a caller bug, never a
// runtime condition. Throwing in onMutate makes TanStack treat the
// mutation as failed — onError still fires (with ctx=undefined since
// onMutate never returned), which rolls back nothing (no optimistic
// write happened) and surfaces the existing reorder toast. A stack
// trace at the throw site points at the bad caller in seconds. The
// alternative (console.warn) buries the signal in a busy dev console
// and lets the corrupted optimistic state propagate until refetch.
//
// Wrapped in `if (import.meta.env.DEV)` so the helper, its closures,
// and the if-branch tree-shake out of prod bundles via Vite's static
// replacement of `import.meta.env.DEV` → `false`. Zero prod overhead.
function assertValidReorderPayload<T extends { id: string; sort_order: number }>(
  updates: { id: string; sort_order: number }[],
  cached: T[] | undefined,
): void {
  // Empty payload is a documented no-op in bulkUpdateSortOrder; skip.
  if (updates.length === 0) return
  // No cache yet (no fetch ever happened) means there's no subset to
  // validate against. Prod behavior is also a no-op here (the cache
  // updater short-circuits on `!curr`).
  if (!cached) return

  const seen = new Set<string>()
  for (const u of updates) {
    if (seen.has(u.id)) {
      throw new Error(
        `makeOptimisticReorder: duplicate id "${u.id}" in payload. Each id must appear at most once.`,
      )
    }
    seen.add(u.id)
  }

  const cachedById = new Map(cached.map((row) => [row.id, row.sort_order]))
  for (const u of updates) {
    if (!cachedById.has(u.id)) {
      throw new Error(
        `makeOptimisticReorder: payload id "${u.id}" is not in the cached list. ` +
          'Either the cache was invalidated between snapshot and dispatch, ' +
          'or the payload was built from a stale view.',
      )
    }
  }

  const payloadOrders = updates.map((u) => u.sort_order).sort((a, b) => a - b)
  const subsetOrders = updates
    .map((u) => cachedById.get(u.id) as number)
    .sort((a, b) => a - b)
  for (let i = 0; i < payloadOrders.length; i++) {
    if (payloadOrders[i] !== subsetOrders[i]) {
      throw new Error(
        `makeOptimisticReorder: payload sort_order values [${payloadOrders.join(', ')}] ` +
          `are not a permutation of the touched subset's existing sort_orders ` +
          `[${subsetOrders.join(', ')}]. ` +
          'Use assignSortOrderSlots() (src/lib/grouping.ts) to build safe payloads.',
      )
    }
  }
}

export function makeOptimisticReorder<T extends { id: string; sort_order: number }>(
  qc: QueryClient,
  queryKey: QueryKey,
) {
  return {
    onMutate: (updates: { id: string; sort_order: number }[]) => {
      qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<T[]>(queryKey)
      if (import.meta.env.DEV) assertValidReorderPayload(updates, previous)
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
      // The rollback is otherwise silent: items just snap back to their
      // original positions. Without a toast, users on a flaky connection
      // can't distinguish "save failed" from "I dragged it back myself".
      showToast("Couldn't save the new order. Please try again.", { type: 'error' })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey })
    },
  }
}
