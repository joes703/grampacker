import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createPackingLocation,
  deletePackingLocation,
  makeOptimisticDelete,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  queryKeys,
  renamePackingLocation,
} from '../lib/queries'
import { mutationKeys } from '../lib/queries/keys'
import { randomTempId } from '../lib/random-temp-id'
import type { PackingLocation } from '../lib/types'

export function promotedContainerSortOrder(locations: PackingLocation[]): number {
  return locations.length === 0
    ? 0
    : Math.min(...locations.map((location) => location.sortOrder)) - 1
}

export function usePackingLocationActions(listId: string, locations: PackingLocation[]) {
  const qc = useQueryClient()
  const queryKey = queryKeys.packingLocations(listId)

  const createLocation = useMutation({
    mutationKey: mutationKeys.createPackingLocation(listId),
    mutationFn: (name: string) => createPackingLocation(listId, { name }),
    ...makeOptimisticInsert<PackingLocation, string>({
      qc,
      queryKey,
      optimistic: (name) => ({
        id: `temp-${randomTempId()}`,
        name,
        containerListItemId: null,
        sortOrder: locations.reduce((max, location) => Math.max(max, location.sortOrder), -1) + 1,
      }),
    }),
  })

  const createItemContainer = useMutation({
    mutationKey: mutationKeys.createItemContainer(listId),
    mutationFn: ({ itemId }: { itemId: string; name: string }) =>
      createPackingLocation(listId, { containerListItemId: itemId }),
    ...makeOptimisticInsert<PackingLocation, { itemId: string; name: string }>({
      qc,
      queryKey,
      optimistic: ({ itemId, name }) => ({
        id: `temp-${randomTempId()}`,
        name,
        containerListItemId: itemId,
        sortOrder: promotedContainerSortOrder(locations),
      }),
    }),
  })

  const renameLocation = useMutation({
    mutationKey: mutationKeys.renamePackingLocation(listId),
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renamePackingLocation(listId, id, name),
    ...makeOptimisticUpdate<PackingLocation, { id: string; name: string }>({
      qc,
      queryKey,
      id: ({ id }) => id,
      apply: (location, { name }) => ({ ...location, name }),
    }),
  })

  const removeLocation = useMutation({
    mutationKey: mutationKeys.removePackingLocation(listId),
    mutationFn: (id: string) => deletePackingLocation(listId, id),
    // Toasted per the rule in src/lib/mutation-error-handler.ts: the confirm
    // closes before mutating, and the rollback also has to put this location's
    // items BACK out of Unassigned - a change spread across rows the user is not
    // watching. Rename above stays silent; its snap-back is in-place.
    ...makeOptimisticDelete<PackingLocation, string>({
      qc,
      queryKey,
      id: (id) => id,
      invalidateKeys: [queryKeys.listItems(listId)],
      errorToast: "Couldn't confirm that packing location was deleted. Refresh to check before trying again.",
    }),
  })

  return {
    createLocation,
    createItemContainer,
    renameLocation,
    removeLocation,
  }
}
