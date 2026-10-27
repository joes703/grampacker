import { queryOptions, skipToken } from '@tanstack/react-query'
// Fetchers come through the package index, so a test that mocks
// '../lib/queries' controls them here too.
import {
  fetchCategories,
  fetchGearItems,
  fetchListFood,
  fetchListItems,
  fetchLists,
  fetchPackingLocations,
  fetchSharedList,
} from './index'
import { queryKeys } from './keys'

// One definition per cache: its key and its fetcher together, typed once.
// Callers spread one in and add only what differs (staleTime, say).
export const queries = {
  lists: () => queryOptions({ queryKey: queryKeys.lists(), queryFn: fetchLists }),
  categories: () => queryOptions({ queryKey: queryKeys.categories(), queryFn: fetchCategories }),
  gearItems: () => queryOptions({ queryKey: queryKeys.gearItems(), queryFn: fetchGearItems }),
  listItems: (listId: string) =>
    queryOptions({ queryKey: queryKeys.listItems(listId), queryFn: () => fetchListItems(listId) }),
  packingLocations: (listId: string) =>
    queryOptions({
      queryKey: queryKeys.packingLocations(listId),
      queryFn: () => fetchPackingLocations(listId),
    }),
  listFood: (listId: string) =>
    queryOptions({ queryKey: queryKeys.listFood(listId), queryFn: () => fetchListFood(listId) }),
  // Waits (skipToken) until the URL has a slug. Resolves to null for "not a
  // shared list" (the fetcher maps only the 404 to null).
  sharedList: (slug: string | undefined) =>
    queryOptions({
      queryKey: queryKeys.sharedList(slug),
      queryFn: slug ? () => fetchSharedList(slug) : skipToken,
    }),
}
