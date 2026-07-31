import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { ApiError } from '../api'
import { showToast } from '../toast'

// This module holds only the pure TanStack Query cache lifecycle helpers
// (insert / update / delete / bulk delete / bulk move / reorder). It must
// stay free of any Supabase import so optimistic.test.ts can evaluate
// the module without VITE_SUPABASE_* env vars. The Supabase-side RPC
// helper for sortOrder writes lives next door in ./bulk-reorder.ts.

// ── Reorder mutation lifecycle ────────────────────────────────────────────────

// Canonical optimistic-update lifecycle for any reorder mutation that takes
// `{id, sortOrder}[]`. Handles cancel → snapshot → optimistic write → roll
// back on error → settle (invalidate). Drop into a useMutation alongside its
// mutationFn:
//
//   useMutation({
//     mutationFn: reorderCategories,
//     ...makeOptimisticReorder<Category>(qc, queryKeys.categories()),
//   })
//
// The cached array gets each affected item's sortOrder rewritten in place
// and is then re-sorted by sortOrder so the visual order matches.
//
// IMPORTANT: `updates` must be a permutation of an existing subset of the
// cached rows. Every id in `updates` must already exist in the cache, and
// the sortOrder values must be a permutation of those rows' existing
// sortOrder values. Passing a partial subset with arbitrary values can
// silently corrupt the cache: rows you didn't touch keep their old
// sortOrder, the merged + sorted result then puts them in surprising
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
//   The cancel still happens; it's just fire-and-forget, and that is
//   fine. cancelQueries issues query.cancel() SYNCHRONOUSLY, and cancel()
//   rejects the retryer's thenable in the same tick, so a still-pending
//   refetch is cancelled here and its response dropped - awaited or not.
//
//   What unawaited gives up is the sliver after a fetch's promise has
//   resolved but before the query wrote the result, where cancel() no-ops
//   and the queued write can land on top of the optimistic order. That
//   sliver is not reachable from a drag: the browser drains the microtask
//   checkpoint (including the query's write) before dispatching the next
//   task, and a drop is a task. It is also self-healing - onSettled
//   invalidates regardless.
//
//   The CRUD helpers below DO await, since they have no animation to be in
//   time for and some callers fire them from a promise chain. See the race
//   suite in optimistic.test.ts, which pins the mechanism.
//
// Corollary — the same-tick rule extends to where the cache is observed,
// not just where it is written. The component that renders the
// SortableContext MUST own the useQuery subscription for the cached
// array it sorts. Receiving the array via a prop drilled from a parent
// observer can split the two state updates (the local setActiveId
// from onDragEnd, and the prop-drilled new order from the parent's
// re-render) across React 18 commits: the local commit lands first
// against the still-old DOM order (dnd-kit's drop animation snaps the
// row back), then the prop commit lands (the row jumps to the new
// position). This is the same visible symptom as the awaited-cancel
// race; the cause is cross-component subscription rather than an
// awaited promise.
//
// useReorderable in src/lib/use-reorderable.ts enforces this rule
// structurally for the flat-reorder surfaces that use it (ListsPage,
// DesktopListsPanel, and GearLibraryPage categories as of this writing):
// the hook owns the useQuery, so a page consuming hook.items cannot
// substitute a parent-prop array without changing what the
// SortableContext renders. For surfaces that still hand-roll DnD
// orchestration (today: within-category item reorder on /lists/:id and
// within-category gear-item reorder on /gear), the rule stays narrated
// and must be honored manually — keep the cache useQuery in the same
// component as the DndContext that uses it.
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
// These helpers AWAIT `cancelQueries` before snapshotting: the canonical TanStack
// pattern. They used to fire it unawaited, borrowing reorder's same-tick rationale
// (below) - which was never theirs to borrow, since no CRUD helper is called from a
// drag and there is no drop animation for the write to be in time for.
//
// Be precise about what awaiting buys, because the usual explanation is wrong:
//
//   The stock claim is "an in-flight refetch resolves after your write and clobbers
//   it". That cannot happen the way it sounds. cancelQueries issues query.cancel()
//   SYNCHRONOUSLY, and cancel() rejects the retryer's thenable in that same tick, so
//   a still-PENDING fetch is cancelled and its late response is dropped by an
//   isResolved() guard. Unawaited was already safe for that case.
//
//   The genuine hole is narrower: the sliver after the fetch's promise has RESOLVED
//   but before the query has written the result. cancel() finds a settled thenable,
//   no-ops, and the queued write lands on top of the optimistic state.
//
//   And that sliver is NOT reachable from a user gesture. The browser drains the
//   whole microtask checkpoint - including the query's write - before dispatching
//   the next task, and a click is a task. To land in it, a caller must invoke the
//   mutation from a promise continuation already queued in that same checkpoint.
//
// So this is a correctness-hardening change, not a user-facing bug fix: it aligns
// with the library's documented contract and closes the hole for callers that fire
// mutations from a promise chain rather than an event handler (ListDetailPage's
// edit dialog chains mutateAsync -> mutateAsync, which is exactly that shape). It is
// honest to call it cheap insurance. It would not be honest to claim it fixed a
// clobber anyone has seen.
//
// Cost: onMutate returns a promise, so the optimistic write lands one microtask
// later. Invisible to a click, and the reason reorder is exempt.
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
    void opts.qc.invalidateQueries({ queryKey: opts.queryKey })
    if (opts.invalidateKeys) {
      for (const k of opts.invalidateKeys) void opts.qc.invalidateQueries({ queryKey: k })
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
  // sortOrder-asc cache in this app since the optimistic row's
  // sortOrder is set to the current array length.
  merge?: (current: TList[], next: TList) => TList[]
}) {
  const { qc, queryKey, optimistic, merge } = opts
  return {
    onMutate: async (input: TInput): Promise<OptimisticContext<TList>> => {
      await qc.cancelQueries({ queryKey })
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
    onMutate: async (input: TInput): Promise<OptimisticContext<TList>> => {
      await qc.cancelQueries({ queryKey })
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
    onMutate: async (input: TInput): Promise<OptimisticContext<TList>> => {
      await qc.cancelQueries({ queryKey })
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

// Remove a SET of rows from the cached array in one write. The bulk
// counterpart of makeOptimisticDelete: same lifecycle, ids resolved from
// the mutation input as a batch. The server applies the batch
// all-or-nothing (one foreign id = zero writes), so a single snapshot/
// rollback matches the server's transaction semantics.
export function makeOptimisticBulkDelete<TList extends { id: string }, TInput>(opts: CommonOpts & {
  ids: (input: TInput) => string[]
}) {
  const { qc, queryKey, ids } = opts
  return {
    onMutate: async (input: TInput): Promise<OptimisticContext<TList>> => {
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<TList[]>(queryKey)
      const idSet = new Set(ids(input))
      qc.setQueryData<TList[]>(queryKey, (curr) => {
        if (!curr) return curr
        return curr.filter((item) => !idSet.has(item.id))
      })
      return { previous }
    },
    onError: makeRollback<TList>(opts),
    onSettled: makeSettled(opts),
  }
}

// Apply the same transform to a SET of rows in one write. The bulk
// counterpart of makeOptimisticUpdate (e.g. move-selected-to-category
// applies `{ ...item, categoryId }` to every selected row).
export function makeOptimisticBulkUpdate<TList extends { id: string }, TInput>(opts: CommonOpts & {
  ids: (input: TInput) => string[]
  apply: (item: TList, input: TInput) => TList
}) {
  const { qc, queryKey, ids, apply } = opts
  return {
    onMutate: async (input: TInput): Promise<OptimisticContext<TList>> => {
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<TList[]>(queryKey)
      const idSet = new Set(ids(input))
      qc.setQueryData<TList[]>(queryKey, (curr) => {
        if (!curr) return curr
        return curr.map((item) => (idSet.has(item.id) ? apply(item, input) : item))
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
//      map-and-spread code: cached rows keep their original sortOrder
//      and the visual order ends up wrong but the helper can't see it.
//   3. The payload's sortOrder multiset must equal the touched cache
//      subset's existing sortOrder multiset. This is the "permutation
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
//
// Pure validator: returns null if the payload is structurally sound, or an
// error message describing the violation. Used both by the DEV branch
// (throws a plain Error — surfaces the bug loudly in tests/dev) AND by
// the prod safety branch (logs + throws a tagged sentinel error onError
// recognizes, so the user sees onSettled's refetch instead of a corrupted
// optimistic cache).
// The pack twin of validateReorderPayload. Same three checks - no duplicate
// ids, every id present in the cache, and the payload's ranks a permutation of
// what those rows already hold - read against packSortOrder.
function validatePackReorderPayload<
  T extends { id: string; packSortOrder: number },
>(
  updates: { id: string; packSortOrder: number }[],
  cached: T[] | undefined,
): string | null {
  if (!cached) return null

  const seen = new Set<string>()
  for (const u of updates) {
    if (seen.has(u.id)) {
      return `makeOptimisticPackReorder: duplicate id "${u.id}" in payload. Each id must appear at most once.`
    }
    seen.add(u.id)
  }

  const cachedById = new Map(cached.map((row) => [row.id, row.packSortOrder]))
  for (const u of updates) {
    if (!cachedById.has(u.id)) {
      return (
        `makeOptimisticPackReorder: payload id "${u.id}" is not in the cached list. ` +
        'Either the cache was invalidated between snapshot and dispatch, ' +
        'or the payload was built from a stale view.'
      )
    }
  }

  const payloadOrders = updates.map((u) => u.packSortOrder).sort((a, b) => a - b)
  const subsetOrders = updates
    .map((u) => cachedById.get(u.id) as number)
    .sort((a, b) => a - b)
  for (let i = 0; i < payloadOrders.length; i++) {
    if (payloadOrders[i] !== subsetOrders[i]) {
      return (
        `makeOptimisticPackReorder: payload packSortOrder values [${payloadOrders.join(', ')}] ` +
        `are not a permutation of the touched subset's existing pack ranks ` +
        `[${subsetOrders.join(', ')}]. ` +
        'Use assignPackRankSlots() (src/lib/grouping.ts) to build safe payloads.'
      )
    }
  }
  return null
}

function validateReorderPayload<T extends { id: string; sortOrder: number }>(
  updates: { id: string; sortOrder: number }[],
  cached: T[] | undefined,
): string | null {
  // Empty payload is a documented no-op in bulkUpdateSortOrder; skip.
  if (updates.length === 0) return null
  // No cache yet (no fetch ever happened) means there's no subset to
  // validate against. Prod behavior is also a no-op here (the cache
  // updater short-circuits on `!curr`).
  if (!cached) return null

  const seen = new Set<string>()
  for (const u of updates) {
    if (seen.has(u.id)) {
      return `makeOptimisticReorder: duplicate id "${u.id}" in payload. Each id must appear at most once.`
    }
    seen.add(u.id)
  }

  const cachedById = new Map(cached.map((row) => [row.id, row.sortOrder]))
  for (const u of updates) {
    if (!cachedById.has(u.id)) {
      return (
        `makeOptimisticReorder: payload id "${u.id}" is not in the cached list. ` +
        'Either the cache was invalidated between snapshot and dispatch, ' +
        'or the payload was built from a stale view.'
      )
    }
  }

  const payloadOrders = updates.map((u) => u.sortOrder).sort((a, b) => a - b)
  const subsetOrders = updates
    .map((u) => cachedById.get(u.id) as number)
    .sort((a, b) => a - b)
  for (let i = 0; i < payloadOrders.length; i++) {
    if (payloadOrders[i] !== subsetOrders[i]) {
      return (
        `makeOptimisticReorder: payload sortOrder values [${payloadOrders.join(', ')}] ` +
        `are not a permutation of the touched subset's existing sort_orders ` +
        `[${subsetOrders.join(', ')}]. ` +
        'Use assignSortOrderSlots() (src/lib/grouping.ts) to build safe payloads.'
      )
    }
  }
  return null
}

// Tag for a thrown error from onMutate that means "payload validation
// failed in prod — don't show the generic reorder-save toast in onError,
// just let onSettled's invalidate refetch authoritative server truth."
// Exported only via the `name` check; not a public API.
class OptimisticReorderValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OptimisticReorderValidationError'
  }
}

// The PACK-order sibling of makeOptimisticReorder below.
//
// It is a separate function rather than a field parameter on that one, and the
// difference is not stylistic. makeOptimisticReorder re-sorts the WHOLE cached
// array by the field it writes; parameterizing it would sort the shared
// list-items cache by packSortOrder, which would corrupt List view order and
// CSV export for every consumer of that same cache. It would also put lists,
// categories, gear items and packing-location reorders in the blast radius of
// a change that is only about one view.
//
// So this one patches ONLY packSortOrder and deliberately leaves the array in
// its canonical document order. The pack renderers sort their own cohorts
// (packing-tree.ts), so they pick the change up without the cache ever
// pretending pack order is the list's order.
export function makeOptimisticPackReorder<
  T extends { id: string; packSortOrder: number },
>(qc: QueryClient, queryKey: QueryKey) {
  return {
    // Synchronous and un-awaited cancel, for the same drag-animation reason as
    // makeOptimisticReorder - see the long note there.
    onMutate: (updates: { id: string; packSortOrder: number }[]) => {
      void qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<T[]>(queryKey)

      // Same permutation rule, read against packSortOrder. It matters more
      // here: pack ranks carry a unique index per cohort server-side, so a
      // non-permutation payload does not merely look wrong, it can collide
      // with a row the payload never mentioned and be rejected wholesale.
      const validationError = validatePackReorderPayload(updates, previous)
      if (validationError) {
        if (import.meta.env.DEV) throw new Error(validationError)
        console.error(
          'makeOptimisticPackReorder validation failed:',
          validationError,
          { updates },
        )
        throw new OptimisticReorderValidationError(validationError)
      }

      const byId = new Map(updates.map((u) => [u.id, u.packSortOrder]))
      qc.setQueryData<T[]>(queryKey, (curr) => {
        if (!curr) return curr
        // No .sort(): the cache stays in document order on purpose.
        return curr.map((item) =>
          byId.has(item.id)
            ? { ...item, packSortOrder: byId.get(item.id)! }
            : item,
        )
      })
      return { previous }
    },
    onError: (
      err: unknown,
      _vars: unknown,
      ctx: { previous: T[] | undefined } | undefined,
    ) => {
      if (err instanceof OptimisticReorderValidationError) return
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous)
      // A 409 means a concurrent reorder of this same bag won and the server
      // rolled ours back whole. Same recovery either way - onSettled refetches
      // - but say which happened, because "try again" is genuinely the fix for
      // one and not the other.
      const conflict = err instanceof ApiError && err.status === 409
      showToast(
        conflict
          ? 'This bag changed somewhere else. Reloading its order.'
          : "Couldn't save the new order. Please try again.",
        { type: 'error' },
      )
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey })
    },
  }
}

export function makeOptimisticReorder<T extends { id: string; sortOrder: number }>(
  qc: QueryClient,
  queryKey: QueryKey,
) {
  return {
    // DELIBERATELY SYNCHRONOUS, and the cancel is DELIBERATELY not awaited.
    // This is the one helper where the same-tick rule is real: dnd-kit starts its
    // drop animation in the tick onDragEnd returns, so an awaited cancel would
    // push the cache write a microtask later, the animation would run against the
    // old DOM order, and the dropped row would visibly snap back to where it
    // started. See the long note at the top of this file.
    //
    // The CRUD helpers above DO await - they are never called from a drag, so
    // they were paying the clobber race for an animation that does not exist. Do
    // not "make these consistent" by awaiting here: the inconsistency is the
    // point, and the accepted race is documented below.
    //
    // Accepted race (unchanged): an in-flight refetch can resolve between this
    // setQueryData and the cancel taking effect, overwriting the optimistic order
    // with stale server truth. Rare (staleTime 30s) and self-healing (onSettled
    // invalidates regardless). Pinned by a test.
    onMutate: (updates: { id: string; sortOrder: number }[]) => {
      void qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<T[]>(queryKey)

      // Validate the payload before writing the cache. DEV throws (loud
      // stack trace, surfaces the bug in development and tests). PROD
      // detects, logs, and aborts with a tagged error onError recognizes:
      // no rollback toast, no cache write, just onSettled's invalidate to
      // pull authoritative server truth. Silent corruption (the prior
      // behavior in prod, since the assertion was DEV-only) is worse than
      // a brief snap-to-server-truth.
      const validationError = validateReorderPayload(updates, previous)
      if (validationError) {
        if (import.meta.env.DEV) throw new Error(validationError)
        console.error('makeOptimisticReorder validation failed:', validationError, { updates })
        throw new OptimisticReorderValidationError(validationError)
      }

      const byId = new Map(updates.map((u) => [u.id, u.sortOrder]))
      qc.setQueryData<T[]>(queryKey, (curr) => {
        if (!curr) return curr
        return curr
          .map((item) => (byId.has(item.id) ? { ...item, sortOrder: byId.get(item.id)! } : item))
          .sort((a, b) => a.sortOrder - b.sortOrder)
      })
      return { previous }
    },
    onError: (
      err: unknown,
      _vars: unknown,
      ctx: { previous: T[] | undefined } | undefined,
    ) => {
      // Prod validation aborts come through here. ctx is undefined (onMutate
      // threw before returning) and there's nothing to roll back (the cache
      // write never happened). onSettled below will refetch authoritative
      // server truth; skip the user-facing toast.
      if (err instanceof OptimisticReorderValidationError) return

      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous)
      // The rollback is otherwise silent: items just snap back to their
      // original positions. Without a toast, users on a flaky connection
      // can't distinguish "save failed" from "I dragged it back myself".
      showToast("Couldn't save the new order. Please try again.", { type: 'error' })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey })
    },
  }
}
