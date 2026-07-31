import { arrayMove } from '@dnd-kit/sortable'
import { parseDnDId } from '../lib/dnd-ids'
import type { DnDIdKind } from '../lib/dnd-ids'
import { assignPackRankSlots } from '../lib/grouping'
import type { ListItemWithGear } from '../lib/types'

export type PackingItemDrop = { itemId: string; locationId: string | null }

export function planPackingItemReorder(
  activeId: string,
  overId: string | undefined,
  items: ListItemWithGear[],
  dndKind: Extract<DnDIdKind, 'item' | 'packing-item'> = 'packing-item',
  excludedItemIds: ReadonlySet<string> = new Set(),
): { id: string; packSortOrder: number }[] | null {
  if (overId === undefined || activeId === overId) return null
  const active = parseDnDId(activeId)
  const over = parseDnDId(overId)
  if (active?.kind !== dndKind || over?.kind !== dndKind) return null

  const activeItem = items.find((item) => item.id === active.id)
  const overItem = items.find((item) => item.id === over.id)
  if (!activeItem || !overItem) return null
  if (excludedItemIds.has(activeItem.id) || excludedItemIds.has(overItem.id)) return null
  if (activeItem.packingLocationId !== overItem.packingLocationId) return null

  const locationItems = items
    .filter((item) =>
      item.packingLocationId === activeItem.packingLocationId &&
      !excludedItemIds.has(item.id),
    )
    // Pack order: this array IS one cohort, which is the scope packSortOrder
    // ranks within. Sorting by document order here would compute the move
    // against a sequence the user is not looking at.
    .toSorted((a, b) => a.packSortOrder - b.packSortOrder)
  const oldIndex = locationItems.findIndex((item) => item.id === active.id)
  const newIndex = locationItems.findIndex((item) => item.id === over.id)
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null

  return assignPackRankSlots(arrayMove(locationItems, oldIndex, newIndex))
}

export function isPackingCollisionTarget(
  activeId: string,
  targetId: string,
  siblingLocationIdsById: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const active = parseDnDId(activeId)
  const target = parseDnDId(targetId)
  if (!active || !target) return false

  if (active.kind === 'packing-location') {
    return target.kind === 'packing-location'
      && siblingLocationIdsById.get(active.id)?.has(target.id) === true
  }
  if (active.kind === 'packing-item') {
    return target.kind === 'packing-item' || target.kind === 'packing-location'
  }
  return false
}

export function planPackingItemDrop(
  activeId: string,
  overId: string | undefined,
  items: ListItemWithGear[],
  validLocationIds: ReadonlySet<string>,
  containerItemIdByLocation: ReadonlyMap<string, string> = new Map(),
  excludedLocationIdsByItem: ReadonlyMap<string, ReadonlySet<string>>,
): PackingItemDrop | null {
  if (overId === undefined) return null
  const active = parseDnDId(activeId)
  const over = parseDnDId(overId)
  if (active?.kind !== 'packing-item' || !over) return null
  const activeItem = items.find((item) => item.id === active.id)
  if (!activeItem) return null

  let locationId: string | null
  if (over.kind === 'packing-location') {
    locationId = over.id === 'unassigned' ? null : over.id
  } else if (over.kind === 'packing-item') {
    const overItem = items.find((item) => item.id === over.id)
    if (!overItem) return null
    locationId = overItem.packingLocationId
  } else {
    return null
  }

  if (locationId !== null && !validLocationIds.has(locationId)) return null
  if (
    locationId !== null &&
    containerItemIdByLocation.get(locationId) === activeItem.id
  ) return null
  if (
    locationId !== null &&
    excludedLocationIdsByItem.get(activeItem.id)?.has(locationId)
  ) return null
  if (activeItem.packingLocationId === locationId) return null
  return { itemId: activeItem.id, locationId }
}

export type PackingItemDragPlan =
  | { kind: 'reorder'; updates: { id: string; packSortOrder: number }[] }
  | ({ kind: 'move' } & PackingItemDrop)

export function planPackingItemDragEnd(
  activeId: string,
  overId: string | undefined,
  items: ListItemWithGear[],
  validLocationIds: ReadonlySet<string>,
  containerItemIdByLocation: ReadonlyMap<string, string> = new Map(),
  excludedLocationIdsByItem: ReadonlyMap<string, ReadonlySet<string>>,
  excludedReorderItemIds: ReadonlySet<string> = new Set(),
): PackingItemDragPlan | null {
  const excludedItemIds = new Set([
    ...containerItemIdByLocation.values(),
    ...excludedReorderItemIds,
  ])
  const updates = planPackingItemReorder(
    activeId,
    overId,
    items,
    'packing-item',
    excludedItemIds,
  )
  if (updates) return { kind: 'reorder', updates }

  const move = planPackingItemDrop(
    activeId,
    overId,
    items,
    validLocationIds,
    containerItemIdByLocation,
    excludedLocationIdsByItem,
  )
  return move ? { kind: 'move', ...move } : null
}
