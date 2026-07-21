import type { List, ListItemWithGear, PackingLocation } from '../types'

export const PACKING_DATA_VERSION = 2 as const

export type PackingData = {
  version: typeof PACKING_DATA_VERSION
  lists: {
    list: { id: string; name: string }
    locations: {
      id: string
      name: string
      sortOrder: number
      containerListItemId: string | null
    }[]
    items: {
      listItemId: string
      gearItem: { id: string; name: string }
      packingLocationId: string | null
    }[]
  }[]
}

export function buildPackingJson(input: {
  lists: List[]
  allItems: ListItemWithGear[]
  packingLocationsByListId: ReadonlyMap<string, PackingLocation[]>
}): PackingData {
  const itemsByListId = new Map<string, ListItemWithGear[]>()
  for (const item of input.allItems) {
    const bucket = itemsByListId.get(item.listId)
    if (bucket) bucket.push(item)
    else itemsByListId.set(item.listId, [item])
  }

  return {
    version: PACKING_DATA_VERSION,
    lists: input.lists.map((list) => ({
      list: { id: list.id, name: list.name },
      locations: (input.packingLocationsByListId.get(list.id) ?? [])
        .toSorted((a, b) => a.sortOrder - b.sortOrder)
        .map(({ id, name, sortOrder, containerListItemId }) => ({
          id,
          name,
          sortOrder,
          containerListItemId,
        })),
      items: (itemsByListId.get(list.id) ?? []).map((item) => ({
        listItemId: item.id,
        gearItem: { id: item.gearItem.id, name: item.gearItem.name },
        packingLocationId: item.packingLocationId,
      })),
    })),
  }
}
