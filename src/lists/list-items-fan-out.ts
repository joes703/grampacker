import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { ListItemWithGear } from '../lib/types'

// Gear mutations from the list-detail page propagate to every `['list-items', *]`
// query cache that contains a list_item referencing the changed gear_item.
// Without this fan-out an optimistic update or delete only repaints the
// gear-library cache; the row the user is looking at on `/lists/:id` stays
// stale until the settled invalidation finishes its refetch.
//
// `apply` is the caller's per-cache transform — `.map` for an update,
// `.filter` for a delete. The helper handles the cross-cache plumbing:
// finding affected caches, cancelling them, snapshotting them for
// rollback, and returning the snapshots so the mutation's onError and
// onSettled handlers can rollback or invalidate.

export type ListItemsSnapshot = { key: QueryKey; data: ListItemWithGear[] | undefined }

export function fanOutGearListItemsCaches(
  qc: QueryClient,
  gearItemId: string,
  apply: (items: ListItemWithGear[]) => ListItemWithGear[],
): ListItemsSnapshot[] {
  const affected = qc.getQueryCache()
    .findAll({ queryKey: ['list-items'] })
    .filter((q) =>
      (q.state.data as ListItemWithGear[] | undefined)?.some((i) => i.gear_item_id === gearItemId),
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

export function rollbackListItemsCaches(qc: QueryClient, snapshots: ListItemsSnapshot[]): void {
  for (const { key, data } of snapshots) qc.setQueryData(key, data)
}

export function invalidateListItemsCaches(qc: QueryClient, snapshots: ListItemsSnapshot[]): void {
  for (const { key } of snapshots) qc.invalidateQueries({ queryKey: key })
}
