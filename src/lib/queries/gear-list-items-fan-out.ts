import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { UpdateGearItemRequest } from '../../../shared/gear'
import type { GearItem } from './gear'
import { queryKeys } from './keys'
import type { ListItemWithGear } from './list-items'

// Gear mutations render from TWO cache surfaces: the gear library
// (['gear-items']) and every open list view embedding the gear through
// list_items.gearItem (['list-items', listId]). These helpers own the
// cross-cache plumbing the generic optimistic.ts helpers deliberately
// don't (its doc marks multi-cache fan-out out of scope): find the
// affected per-list caches, cancel + snapshot each, apply the same
// logical change, and roll back all of them together.
//
// The embedded gearItem is the full gear DTO, so every field of
// UpdateGearItemRequest is list-visible; gear reorders go through
// makeOptimisticReorder, never through here.

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
// Awaiting the cancels follows the CRUD helpers in optimistic.ts; see "When
// cancelQueries is awaited" there. Cancellation is synchronous, so a still-pending
// refetch is dropped either way. Awaiting also covers the gap where a fetch has
// resolved but not yet written, which a mutation reaches only when it is called
// from a promise continuation rather than an event handler.
//
// Untouched caches are neither canceled nor snapshotted. Deliberate: do not cancel
// a list cache this change cannot affect, or you abort a legitimate in-flight fetch
// for a list the user is looking at right now. A list fetched while the write is in
// flight gets no optimistic write; makeSettled's prefix invalidation corrects it.
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
// The return type keeps TanStack's onSettled shape for callers; the body
// needs none of its arguments.
function makeSettled(
  opts: FanOutOpts,
  { cascades }: { cascades: boolean },
): (data: unknown, err: unknown, vars: unknown, ctx: GearFanOutContext | undefined) => void {
  return () => {
    void opts.qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
    // The whole prefix, not only the snapshots: a list first fetched while the
    // write was in flight may hold the gear's old values.
    void opts.qc.invalidateQueries({ queryKey: queryKeys.listItemsAll() })
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
