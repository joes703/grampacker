import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { EMBEDDED_GEAR_FIELDS, type ListItemWithGear } from '../lib/types'
import { queryKeys } from '../lib/queries/keys'

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

export function fanOutGearListItemsCaches(
  qc: QueryClient,
  gearItemId: string,
  apply: (items: ListItemWithGear[]) => ListItemWithGear[],
): ListItemsSnapshot[] {
  const affected = qc.getQueryCache()
    .findAll({ queryKey: queryKeys.listItemsAll() })
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
