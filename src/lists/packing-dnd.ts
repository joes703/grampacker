import { parseDnDId } from '../lib/dnd-ids'
import type { ListItemWithGear } from '../lib/types'

export type PackingItemDrop = { itemId: string; locationId: string | null }

export function planPackingItemDrop(
  activeId: string,
  overId: string | undefined,
  items: ListItemWithGear[],
  validLocationIds: ReadonlySet<string>,
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
  if (activeItem.packingLocationId === locationId) return null
  return { itemId: activeItem.id, locationId }
}
