import type { Category, PackingLocation } from '../lib/types'
import type { ListItemGrouping } from '../lib/use-grouped-list-items'

export function selectPackGrouping(
  categories: Category[],
  locations: PackingLocation[] | undefined,
): ListItemGrouping {
  return locations !== undefined && locations.length > 0
    ? { kind: 'location', groups: locations }
    : { kind: 'category', groups: categories }
}

export function selectPackGroupingState(
  categories: Category[],
  query: { data: PackingLocation[] | undefined; isError: boolean },
): { grouping: ListItemGrouping; showErrorNotice: boolean } {
  return {
    grouping: selectPackGrouping(categories, query.data),
    showErrorNotice: query.isError,
  }
}
