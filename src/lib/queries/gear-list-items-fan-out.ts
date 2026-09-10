import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { UpdateGearItemRequest } from '../../../shared/gear'
import { showToast } from '../toast'
import type { GearItem } from './gear'
import { queryKeys } from './keys'
import type { ListItemWithGear } from './list-items'

// Gear mutations render from TWO cache surfaces: the gear library
// (['gear-items']) and every open list view embedding the gear through
// list_items.gearItem (['list-items', listId]). These helpers own the
// cross-cache plumbing the generic optimistic.ts helpers deliberately
// don't (its doc marks multi-cache fan-out out of scope): find the
// affected per-list caches, cancel + snapshot each, apply the same
// logical change, and roll back / invalidate ALL of them together.
//
// Re-derived from the old repo's module against the new shapes, not
// copy-pasted (run-level accounting rule). One deliberate drop: the old
// patchAffectsListItemsView() short-circuit skipped the fan-out for
// patches that touched no embedded field - in the old stack the
// embedded projection was 7 columns and gear reorders patched
// sort_order through this path. In this stack the embedded gearItem is
// the FULL gear DTO and every field of UpdateGearItemRequest is
// list-visible, so the filter could never skip anything; reorders go
// through makeOptimisticReorder, never through here.

type ListItemsSnapshot = {
  key: QueryKey
  data: ListItemWithGear[] | undefined
}

export type GearFanOutContext = {
  previousGear: GearItem[] | undefined
  listSnapshots: ListItemsSnapshot[]
}

type FanOutOpts = {
  qc: QueryClient
  // Set on the rollbacks the user would otherwise not notice - bulk surfaces and
  // single-item DELETES alike. Same rule as the generic helpers, stated once in
  // src/lib/mutation-error-handler.ts; an in-place gear EDIT stays silent because
  // its snap-back happens under the user's cursor.
  errorToast?: string
}

// findAll matches by prefix, so it would also return a bare ['list-items'] query
// or any longer-keyed one holding an arbitrary shape. Only the exact two-element
// per-list shape with array data may pass - anything else could blow up the
// `.some` below or take an optimistic write it cannot represent.
function isPerListItemsQuery(key: QueryKey, data: unknown): boolean {
  return key.length === 2 && typeof key[1] === 'string' && Array.isArray(data)
}

// One gear change, two cache surfaces: the gear library (['gear-items']) and every
// open list view embedding that gear. This runs the optimistic opening move across
// both, in order:
//
//   1. find the affected per-list caches
//   2. AWAIT every cancel - gear and lists
//   3. snapshot
//   4. write
//
// Awaiting the cancels is the canonical TanStack pattern, and the same hardening the
// CRUD helpers in optimistic.ts got. Read the note there for what it does and does
// NOT buy: cancellation is synchronous, so a still-pending refetch was already
// handled unawaited; the awaited version additionally covers the sliver where a
// fetch has resolved but not yet written, which is only reachable when a mutation is
// fired from a promise continuation rather than an event handler. Cheap insurance,
// not a bug anyone has hit.
//
// Untouched caches are neither canceled nor snapshotted. Deliberate: do not cancel
// a list cache this change cannot affect, or you abort a legitimate in-flight fetch
// for a list the user is looking at right now.
//
// KNOWN GAP, and it is a real one rather than a rhetorical "residual": the affected
// set is computed at step 1, before the await. A list cache that becomes affected
// during the await gets no optimistic write - and, worse, makeSettled invalidates
// only the caches in listSnapshots, so it is never invalidated either. It would sit
// stale until some unrelated refetch, NOT until the settle. (The gap does not bite
// today: the await spans microtasks only, and a fetch cannot COMPLETE inside a
// microtask checkpoint, so no cache can newly acquire the gear in that window. It
// would bite the moment anything awaited here does real async work.) If that ever
// changes, invalidate the ['list-items'] prefix on settle, or recompute the affected
// set after the cancels.
async function beginGearFanOut(
  qc: QueryClient,
  gearItemIds: ReadonlySet<string>,
  applyGear: (curr: GearItem[]) => GearItem[],
  applyList: (items: ListItemWithGear[]) => ListItemWithGear[],
): Promise<GearFanOutContext> {
  const gearKey = queryKeys.gearItems()

  const affectedKeys = qc
    .getQueryCache()
    .findAll({ queryKey: queryKeys.listItemsAll() })
    .filter(
      (q) =>
        isPerListItemsQuery(q.queryKey, q.state.data) &&
        (q.state.data as ListItemWithGear[]).some((i) =>
          gearItemIds.has(i.gearItemId),
        ),
    )
    .map((q) => q.queryKey)

  await Promise.all([
    qc.cancelQueries({ queryKey: gearKey }),
    ...affectedKeys.map((key) => qc.cancelQueries({ queryKey: key })),
  ])

  const previousGear = qc.getQueryData<GearItem[]>(gearKey)
  const listSnapshots: ListItemsSnapshot[] = affectedKeys.map((key) => ({
    key,
    data: qc.getQueryData<ListItemWithGear[]>(key),
  }))

  qc.setQueryData<GearItem[]>(gearKey, (curr) => (curr ? applyGear(curr) : curr))
  for (const { key } of listSnapshots) {
    qc.setQueryData<ListItemWithGear[]>(key, (curr) =>
      curr ? applyList(curr) : curr,
    )
  }

  return { previousGear, listSnapshots }
}

function makeRollback(opts: FanOutOpts) {
  return (_err: unknown, _vars: unknown, ctx: GearFanOutContext | undefined) => {
    if (ctx?.previousGear) {
      opts.qc.setQueryData(queryKeys.gearItems(), ctx.previousGear)
    }
    for (const { key, data } of ctx?.listSnapshots ?? []) {
      opts.qc.setQueryData(key, data)
    }
    if (opts.errorToast) showToast(opts.errorToast, { type: 'error' })
  }
}

// `cascades`: the mutation is a DELETE, which the server cascades past
// list_items. A deleted gear row that backed a packing location deletes that
// location, and the location's SET NULL + rerank moves gear AND food rows
// (the membership-delete path in src/lists/use-list-item-actions.ts
// invalidates the same two caches for the same reason). Those families are
// invalidated by prefix, not per snapshot: a list can have its locations or
// food cached while its list-items query is failed or pending, and then it
// has no snapshot here to be discovered through. An update or a category
// move cascades nothing and leaves them alone.
function makeSettled(opts: FanOutOpts, { cascades }: { cascades: boolean }) {
  return (
    _data: unknown,
    _err: unknown,
    _vars: unknown,
    ctx: GearFanOutContext | undefined,
  ) => {
    void opts.qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
    for (const { key } of ctx?.listSnapshots ?? []) {
      void opts.qc.invalidateQueries({ queryKey: key })
    }
    if (cascades) {
      void opts.qc.invalidateQueries({ queryKey: queryKeys.packingLocationsAll() })
      void opts.qc.invalidateQueries({ queryKey: queryKeys.listFoodAll() })
    }
  }
}

// PATCH semantics: undefined = unchanged. Strip undefined so a spread
// cannot overwrite a real value with it (same rule as the gear hook).
function mergePatch<T extends object>(target: T, patch: object): T {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      ;(next as Record<string, unknown>)[key] = value
    }
  }
  return next
}

export function makeOptimisticGearItemUpdate(opts: FanOutOpts) {
  type Input = { id: string; patch: UpdateGearItemRequest }
  return {
    onMutate: (input: Input): Promise<GearFanOutContext> =>
      beginGearFanOut(
        opts.qc,
        new Set([input.id]),
        (curr) =>
          curr.map((g) => (g.id === input.id ? mergePatch(g, input.patch) : g)),
        (items) =>
          items.map((item) =>
            item.gearItemId === input.id
              ? { ...item, gearItem: mergePatch(item.gearItem, input.patch) }
              : item,
          ),
      ),
    onError: makeRollback(opts),
    onSettled: makeSettled(opts, { cascades: false }),
  }
}

// The server cascades list_items on gear delete, so the optimistic
// shape drops the membership rows too, not just the library row.
export function makeOptimisticGearItemDelete(opts: FanOutOpts) {
  return {
    onMutate: (id: string): Promise<GearFanOutContext> =>
      beginGearFanOut(
        opts.qc,
        new Set([id]),
        (curr) => curr.filter((g) => g.id !== id),
        (items) => items.filter((item) => item.gearItemId !== id),
      ),
    onError: makeRollback(opts),
    onSettled: makeSettled(opts, { cascades: true }),
  }
}

export function makeOptimisticGearItemsBulkDelete(opts: FanOutOpts) {
  return {
    onMutate: (ids: string[]): Promise<GearFanOutContext> => {
      const idSet = new Set(ids)
      return beginGearFanOut(
        opts.qc,
        idSet,
        (curr) => curr.filter((g) => !idSet.has(g.id)),
        (items) => items.filter((item) => !idSet.has(item.gearItemId)),
      )
    },
    onError: makeRollback(opts),
    onSettled: makeSettled(opts, { cascades: true }),
  }
}

export function makeOptimisticGearItemsBulkCategoryMove(opts: FanOutOpts) {
  type Input = { ids: string[]; categoryId: string | null }
  return {
    onMutate: (input: Input): Promise<GearFanOutContext> => {
      const idSet = new Set(input.ids)
      return beginGearFanOut(
        opts.qc,
        idSet,
        (curr) =>
          curr.map((g) =>
            idSet.has(g.id) ? { ...g, categoryId: input.categoryId } : g,
          ),
        (items) =>
          items.map((item) =>
            idSet.has(item.gearItemId)
              ? {
                  ...item,
                  gearItem: { ...item.gearItem, categoryId: input.categoryId },
                }
              : item,
          ),
      )
    },
    onError: makeRollback(opts),
    onSettled: makeSettled(opts, { cascades: false }),
  }
}
