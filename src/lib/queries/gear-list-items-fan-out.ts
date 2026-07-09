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
  // Bulk surfaces layer an explicit toast on the rollback (a bulk
  // failure is easy to miss); single-item surfaces rely on the global
  // mutation error handler, same split as the generic helpers.
  errorToast?: string
}

// Snapshot-and-apply across every per-list cache that references one of
// the changed gear ids. Untouched caches are neither cancelled nor
// snapshotted - their identity must not churn.
function fanOutListItemsCaches(
  qc: QueryClient,
  gearItemIds: ReadonlySet<string>,
  apply: (items: ListItemWithGear[]) => ListItemWithGear[],
): ListItemsSnapshot[] {
  const affected = qc
    .getQueryCache()
    .findAll({ queryKey: queryKeys.listItemsAll() })
    .filter((q) =>
      (q.state.data as ListItemWithGear[] | undefined)?.some((i) =>
        gearItemIds.has(i.gearItemId),
      ),
    )
  const snapshots: ListItemsSnapshot[] = []
  for (const q of affected) {
    const key = q.queryKey
    void qc.cancelQueries({ queryKey: key })
    snapshots.push({ key, data: qc.getQueryData<ListItemWithGear[]>(key) })
    qc.setQueryData<ListItemWithGear[]>(key, (curr) =>
      curr ? apply(curr) : curr,
    )
  }
  return snapshots
}

function beginGearWrite(
  qc: QueryClient,
  apply: (curr: GearItem[]) => GearItem[],
): GearItem[] | undefined {
  void qc.cancelQueries({ queryKey: queryKeys.gearItems() })
  const previous = qc.getQueryData<GearItem[]>(queryKeys.gearItems())
  qc.setQueryData<GearItem[]>(queryKeys.gearItems(), (curr) =>
    curr ? apply(curr) : curr,
  )
  return previous
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

function makeSettled(opts: FanOutOpts) {
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
    onMutate: (input: Input): GearFanOutContext => {
      const previousGear = beginGearWrite(opts.qc, (curr) =>
        curr.map((g) => (g.id === input.id ? mergePatch(g, input.patch) : g)),
      )
      const listSnapshots = fanOutListItemsCaches(
        opts.qc,
        new Set([input.id]),
        (items) =>
          items.map((item) =>
            item.gearItemId === input.id
              ? { ...item, gearItem: mergePatch(item.gearItem, input.patch) }
              : item,
          ),
      )
      return { previousGear, listSnapshots }
    },
    onError: makeRollback(opts),
    onSettled: makeSettled(opts),
  }
}

// The server cascades list_items on gear delete, so the optimistic
// shape drops the membership rows too, not just the library row.
export function makeOptimisticGearItemDelete(opts: FanOutOpts) {
  return {
    onMutate: (id: string): GearFanOutContext => {
      const previousGear = beginGearWrite(opts.qc, (curr) =>
        curr.filter((g) => g.id !== id),
      )
      const listSnapshots = fanOutListItemsCaches(
        opts.qc,
        new Set([id]),
        (items) => items.filter((item) => item.gearItemId !== id),
      )
      return { previousGear, listSnapshots }
    },
    onError: makeRollback(opts),
    onSettled: makeSettled(opts),
  }
}

export function makeOptimisticGearItemsBulkDelete(opts: FanOutOpts) {
  return {
    onMutate: (ids: string[]): GearFanOutContext => {
      const idSet = new Set(ids)
      const previousGear = beginGearWrite(opts.qc, (curr) =>
        curr.filter((g) => !idSet.has(g.id)),
      )
      const listSnapshots = fanOutListItemsCaches(opts.qc, idSet, (items) =>
        items.filter((item) => !idSet.has(item.gearItemId)),
      )
      return { previousGear, listSnapshots }
    },
    onError: makeRollback(opts),
    onSettled: makeSettled(opts),
  }
}

export function makeOptimisticGearItemsBulkCategoryMove(opts: FanOutOpts) {
  type Input = { ids: string[]; categoryId: string | null }
  return {
    onMutate: (input: Input): GearFanOutContext => {
      const idSet = new Set(input.ids)
      const previousGear = beginGearWrite(opts.qc, (curr) =>
        curr.map((g) =>
          idSet.has(g.id) ? { ...g, categoryId: input.categoryId } : g,
        ),
      )
      const listSnapshots = fanOutListItemsCaches(opts.qc, idSet, (items) =>
        items.map((item) =>
          idSet.has(item.gearItemId)
            ? {
                ...item,
                gearItem: { ...item.gearItem, categoryId: input.categoryId },
              }
            : item,
        ),
      )
      return { previousGear, listSnapshots }
    },
    onError: makeRollback(opts),
    onSettled: makeSettled(opts),
  }
}
