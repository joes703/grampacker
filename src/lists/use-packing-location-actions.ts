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
import { randomTempId } from '../lib/random-temp-id'
import type { PackingLocation } from '../lib/types'

export function usePackingLocationActions(listId: string, locations: PackingLocation[]) {
  const qc = useQueryClient()
  const queryKey = queryKeys.packingLocations(listId)

  const createLocation = useMutation({
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
    mutationFn: ({ itemId }: { itemId: string; name: string }) =>
      createPackingLocation(listId, { containerListItemId: itemId }),
    ...makeOptimisticInsert<PackingLocation, { itemId: string; name: string }>({
      qc,
      queryKey,
      optimistic: ({ itemId, name }) => ({
        id: `temp-${randomTempId()}`,
        name,
        containerListItemId: itemId,
        sortOrder: locations.reduce(
          (max, location) => Math.max(max, location.sortOrder),
          -1,
        ) + 1,
      }),
    }),
  })

  const renameLocation = useMutation({
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
    mutationFn: (id: string) => deletePackingLocation(listId, id),
    ...makeOptimisticDelete<PackingLocation, string>({
      qc,
      queryKey,
      id: (id) => id,
      invalidateKeys: [queryKeys.listItems(listId)],
    }),
  })

  return {
    createLocation,
    createItemContainer,
    renameLocation,
    removeLocation,
  }
}
