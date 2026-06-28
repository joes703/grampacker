import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { EMBEDDED_GEAR_FIELDS, type GearItem, type ListItemWithGear } from '../types'
import { queryKeys } from './keys'

// Gear mutations from owner surfaces propagate to every `['list-items', *]`
// query cache that contains a list_item referencing the changed gear_item.
// Without this fan-out an optimistic update or delete only repaints the
// initiating cache; the row the user is looking at on `/lists/:id` stays stale
// until the settled invalidation finishes its refetch.
//
// `apply` is the caller's per-cache transform — `.map` for an update,
// `.filter` for a delete. The helper handles the cross-cache plumbing:
// finding affected caches, cancelling them, snapshotting them for
// rollback, and returning the snapshots so the mutation's onError and
// onSettled handlers can rollback or invalidate.

// The gear_items columns projected into private list_items.gear_item (see
// fetchListItems / fetchAllUserListItems) come from the canonical
// EMBEDDED_GEAR_FIELDS tuple in lib/types.ts. A gear-edit patch that doesn't
// touch any of these fields cannot change anything the list view renders, so
// its fan-out across every ['list-items', *] cache is wasted work. CLAUDE.md
// "Cache invalidation rules" calls this out explicitly for sort_order:
// gear_items.sort_order changes are invisible to list_items consumers, which
// order by their own list_items.sort_order column.
const EMBEDDED_GEAR_FIELD_SET: ReadonlySet<string> = new Set(EMBEDDED_GEAR_FIELDS)

export function patchAffectsListItemsView(patch: Record<string, unknown>): boolean {
  for (const key of Object.keys(patch)) {
    if (EMBEDDED_GEAR_FIELD_SET.has(key)) return true
  }
  return false
}

export type ListItemsSnapshot = { key: QueryKey; data: ListItemWithGear[] | undefined }

type GearItemPatch = Partial<
  Pick<
    GearItem,
    'name' | 'description' | 'weight_grams' | 'category_id' | 'cost' | 'purchase_date' | 'status'
  >
>

type GearItemsSnapshot = { data: GearItem[] | undefined }

export type GearListItemsFanoutContext = GearItemsSnapshot & {
  listSnapshots: ListItemsSnapshot[]
}

function gearPatchForListItems(patch: GearItemPatch): Partial<ListItemWithGear['gear_item']> {
  const next: Partial<ListItemWithGear['gear_item']> = {}
  for (const field of EMBEDDED_GEAR_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      next[field] = patch[field] as never
    }
  }
  return next
}

function fanOutGearListItemsCachesByIds(
  qc: QueryClient,
  gearItemIds: ReadonlySet<string>,
  apply: (items: ListItemWithGear[]) => ListItemWithGear[],
): ListItemsSnapshot[] {
  const affected = qc.getQueryCache()
    .findAll({ queryKey: queryKeys.listItemsAll() })
    .filter((q) =>
      (q.state.data as ListItemWithGear[] | undefined)?.some((i) => gearItemIds.has(i.gear_item_id)),
    )
  const snapshots: ListItemsSnapshot[] = []
  for (const q of affected) {
    const key = q.queryKey
    qc.cancelQueries({ queryKey: key })
    snapshots.push({ key, data: qc.getQueryData<ListItemWithGear[]>(key) })
    qc.setQueryData<ListItemWithGear[]>(key, (curr) => (curr ? apply(curr) : curr))
  }
  return snapshots
}

export function fanOutGearListItemsCaches(
  qc: QueryClient,
  gearItemId: string,
  apply: (items: ListItemWithGear[]) => ListItemWithGear[],
): ListItemsSnapshot[] {
  return fanOutGearListItemsCachesByIds(qc, new Set([gearItemId]), apply)
}

export function rollbackListItemsCaches(qc: QueryClient, snapshots: ListItemsSnapshot[]): void {
  for (const { key, data } of snapshots) qc.setQueryData(key, data)
}

export function invalidateListItemsCaches(qc: QueryClient, snapshots: ListItemsSnapshot[]): void {
  for (const { key } of snapshots) qc.invalidateQueries({ queryKey: key })
}

function rollbackGearItems(qc: QueryClient, ctx: GearItemsSnapshot | undefined): void {
  if (ctx?.data) qc.setQueryData(queryKeys.gearItems(), ctx.data)
}

function invalidateGearFanout(qc: QueryClient, ctx: GearListItemsFanoutContext | undefined): void {
  qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
  if (ctx?.listSnapshots) invalidateListItemsCaches(qc, ctx.listSnapshots)
}

export function makeOptimisticGearItemUpdate(qc: QueryClient) {
  return {
    onMutate: (input: { id: string; patch: GearItemPatch }): GearListItemsFanoutContext => {
      qc.cancelQueries({ queryKey: queryKeys.gearItems() })
      const previousGear = qc.getQueryData<GearItem[]>(queryKeys.gearItems())
      qc.setQueryData<GearItem[]>(queryKeys.gearItems(), (curr) =>
        curr ? curr.map((g) => (g.id === input.id ? { ...g, ...input.patch } : g)) : curr,
      )
      const listPatch = gearPatchForListItems(input.patch)
      const listSnapshots = patchAffectsListItemsView(input.patch)
        ? fanOutGearListItemsCaches(qc, input.id, (items) =>
            items.map((item) =>
              item.gear_item_id === input.id
                ? { ...item, gear_item: { ...item.gear_item, ...listPatch } }
                : item,
            ),
          )
        : []
      return { data: previousGear, listSnapshots }
    },
    onError: (
      _err: unknown,
      _vars: { id: string; patch: GearItemPatch },
      ctx: GearListItemsFanoutContext | undefined,
    ) => {
      rollbackGearItems(qc, ctx)
      if (ctx?.listSnapshots) rollbackListItemsCaches(qc, ctx.listSnapshots)
    },
    onSettled: (
      _data: unknown,
      _err: unknown,
      _vars: { id: string; patch: GearItemPatch },
      ctx: GearListItemsFanoutContext | undefined,
    ) => {
      invalidateGearFanout(qc, ctx)
    },
  }
}

export function makeOptimisticGearItemDelete(qc: QueryClient) {
  return {
    onMutate: (id: string): GearListItemsFanoutContext => {
      qc.cancelQueries({ queryKey: queryKeys.gearItems() })
      const previousGear = qc.getQueryData<GearItem[]>(queryKeys.gearItems())
      qc.setQueryData<GearItem[]>(queryKeys.gearItems(), (curr) =>
        curr ? curr.filter((g) => g.id !== id) : curr,
      )
      const listSnapshots = fanOutGearListItemsCaches(qc, id, (items) =>
        items.filter((item) => item.gear_item_id !== id),
      )
      return { data: previousGear, listSnapshots }
    },
    onError: (_err: unknown, _vars: string, ctx: GearListItemsFanoutContext | undefined) => {
      rollbackGearItems(qc, ctx)
      if (ctx?.listSnapshots) rollbackListItemsCaches(qc, ctx.listSnapshots)
    },
    onSettled: (
      _data: unknown,
      _err: unknown,
      _vars: string,
      ctx: GearListItemsFanoutContext | undefined,
    ) => {
      invalidateGearFanout(qc, ctx)
    },
  }
}

export function makeOptimisticGearItemsBulkDelete(qc: QueryClient) {
  return {
    onMutate: (ids: string[]): GearListItemsFanoutContext => {
      qc.cancelQueries({ queryKey: queryKeys.gearItems() })
      const previousGear = qc.getQueryData<GearItem[]>(queryKeys.gearItems())
      const idSet = new Set(ids)
      if (idSet.size > 0) {
        qc.setQueryData<GearItem[]>(queryKeys.gearItems(), (curr) =>
          curr ? curr.filter((g) => !idSet.has(g.id)) : curr,
        )
      }
      const listSnapshots =
        idSet.size > 0
          ? fanOutGearListItemsCachesByIds(qc, idSet, (items) =>
              items.filter((item) => !idSet.has(item.gear_item_id)),
            )
          : []
      return { data: previousGear, listSnapshots }
    },
    onError: (_err: unknown, _vars: string[], ctx: GearListItemsFanoutContext | undefined) => {
      rollbackGearItems(qc, ctx)
      if (ctx?.listSnapshots) rollbackListItemsCaches(qc, ctx.listSnapshots)
    },
    onSettled: (
      _data: unknown,
      _err: unknown,
      _vars: string[],
      ctx: GearListItemsFanoutContext | undefined,
    ) => {
      invalidateGearFanout(qc, ctx)
    },
  }
}

export function makeOptimisticGearItemsBulkCategoryMove(qc: QueryClient) {
  type Input = { ids: string[]; categoryId: string | null }
  return {
    onMutate: (input: Input): GearListItemsFanoutContext => {
      qc.cancelQueries({ queryKey: queryKeys.gearItems() })
      const previousGear = qc.getQueryData<GearItem[]>(queryKeys.gearItems())
      const idSet = new Set(input.ids)
      if (idSet.size > 0) {
        qc.setQueryData<GearItem[]>(queryKeys.gearItems(), (curr) =>
          curr
            ? curr.map((g) => (idSet.has(g.id) ? { ...g, category_id: input.categoryId } : g))
            : curr,
        )
      }
      const listSnapshots =
        idSet.size > 0
          ? fanOutGearListItemsCachesByIds(qc, idSet, (items) =>
              items.map((item) =>
                idSet.has(item.gear_item_id)
                  ? { ...item, gear_item: { ...item.gear_item, category_id: input.categoryId } }
                  : item,
              ),
            )
          : []
      return { data: previousGear, listSnapshots }
    },
    onError: (_err: unknown, _vars: Input, ctx: GearListItemsFanoutContext | undefined) => {
      rollbackGearItems(qc, ctx)
      if (ctx?.listSnapshots) rollbackListItemsCaches(qc, ctx.listSnapshots)
    },
    onSettled: (
      _data: unknown,
      _err: unknown,
      _vars: Input,
      ctx: GearListItemsFanoutContext | undefined,
    ) => {
      invalidateGearFanout(qc, ctx)
    },
  }
}
