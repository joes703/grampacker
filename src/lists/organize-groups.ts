import { groupListItemsByLocation, type LocationGroup } from '../lib/grouping'
import type { ListItemWithGear, PackingLocation } from '../lib/types'

export function buildOrganizeGroups(
  items: ListItemWithGear[],
  locations: PackingLocation[],
): LocationGroup<ListItemWithGear>[] {
  const grouped = groupListItemsByLocation(
    items.filter((item) => !item.isWorn),
    locations,
  )
  if (grouped.some((group) => group.location === null)) return grouped
  return [...grouped, { location: null, items: [] }]
}
