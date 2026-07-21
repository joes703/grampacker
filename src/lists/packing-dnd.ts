import { parseDnDId } from '../lib/dnd-ids'
import type { ListItemWithGear } from '../lib/types'

export type PackingItemDrop = { itemId: string; locationId: string | null }

export function isPackingCollisionTarget(
  activeId: string,
  targetId: string,
): boolean {
  const active = parseDnDId(activeId)
  const target = parseDnDId(targetId)
  if (!active || !target) return false

  if (active.kind === 'packing-location') {
    return target.kind === 'packing-location' && target.id !== 'unassigned'
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
  if (activeItem.packingLocationId === locationId) return null
  return { itemId: activeItem.id, locationId }
}
