import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import {
  queryKeys,
  updateList,
  duplicateList,
  deleteList,
  createList,
  fetchListItems,
  fetchCategories,
  makeOptimisticUpdate,
  makeOptimisticDelete,
  makeOptimisticInsert,
  nextListSortOrder,
} from '../lib/queries'
import { listItemsToCsv, downloadCsv } from '../lib/csv'
import { optimisticListPlaceholder } from '../lib/optimistic-list-placeholder'
import { showToast } from '../lib/toast'
import type { Category, List } from '../lib/types'

// createListMut variables: the name plus the append sortOrder snapshotted at
// submit time. Carried together so the optimistic placeholder consumes one
// immutable per-invocation value (see submitCreateList). The SERVER assigns
// the persisted sortOrder on create; the snapshot only positions the
// placeholder where the server row will land.
type CreateListVars = { name: string; sortOrder: number }

// Shared current-list actions hook. Both the /lists card kebab
// (ListsPage) and the in-list List options popover/modal
// (ListSettingsPanel) call this to get the same rename / duplicate /
// delete / exportCsv handlers. Same mutations, same write paths, same
// optimistic-update shapes - one canonical code path, multiple entry
// points.
export function useCurrentListActions() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  // Which list has an export in flight (drives the kebab's "Exporting…"
  // state). Per-list rather than boolean so a slow export on one list
  // doesn't disable the action on every other card.
  const [exportingListId, setExportingListId] = useState<string | null>(null)

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateList(id, { name }),
    ...makeOptimisticUpdate<List, { id: string; name: string }>({
      qc,
      queryKey: queryKeys.lists(),
      id: ({ id }) => id,
      apply: (item, { name }) => ({
        ...item,
        name,
        updatedAt: new Date().toISOString(),
      }),
    }),
  })

  // Toggle a list between draft (still being built) and complete. Label
  // only - never locks editing. Optimistic on the ['lists'] cache; isDraft
  // does not affect list_items, so no ['list-items'] invalidation. Shared by
  // CurrentListHeader (the clickable "Mark list complete" pill) and
  // ListSettingsPanel (the Draft toggle).
  const draftMut = useMutation({
    mutationFn: (target: List) => updateList(target.id, { isDraft: !target.isDraft }),
    ...makeOptimisticUpdate<List, List>({
      qc,
      queryKey: queryKeys.lists(),
      id: (target) => target.id,
      apply: (item) => ({
        ...item,
        isDraft: !item.isDraft,
        updatedAt: new Date().toISOString(),
      }),
    }),
  })

  // Create a new list. The append sortOrder is captured ONCE per invocation -
  // in submitCreateList below, from the pre-insert ['lists'] cache - and passed
  // as an immutable mutation variable, so the optimistic placeholder consumes
  // a value that ignores itself. This matters because
  // makeOptimisticInsert.onMutate appends the placeholder to the cache BEFORE
  // mutationFn runs; recomputing the position later would count that
  // placeholder and slot the row one position too high. Threading the value
  // through the variables (rather than a shared ref) also keeps two
  // near-simultaneous creates from corrupting each other's value. The server
  // assigns the persisted slot from its own max+1, which matches this
  // snapshot whenever the cache is fresh; the settled refetch reconciles any
  // race.
  const createListMut = useMutation({
    mutationFn: ({ name }: CreateListVars) => createList(name),
    meta: { errorToast: "Couldn't create the list. Please try again." },
    ...makeOptimisticInsert<List, CreateListVars>({
      qc,
      queryKey: queryKeys.lists(),
      optimistic: ({ name, sortOrder }) => optimisticListPlaceholder({ name, sortOrder }),
    }),
    // Navigate on the SERVER row's id, never the placeholder's - the
    // placeholder id points at a list that doesn't exist server-side.
    onSuccess: (created) => void navigate(`/lists/${created.id}`),
  })

  // Hook-owned submit wrapper: snapshot the append sortOrder from the live
  // ['lists'] cache once, then fire the mutation with that immutable value.
  // Callers trigger creation through this (not createListMut.mutate directly)
  // and read createListMut.isPending for the saving state. Dialog-closing stays
  // caller-owned, so the page passes { onSuccess: () => setDialog(null) } here;
  // the optimistic-insert helper owns onSettled (invalidate), and the mutation's
  // own onSuccess (navigate) runs before this per-call onSuccess.
  const submitCreateList = useCallback(
    (name: string, options?: Parameters<typeof createListMut.mutate>[1]) => {
      const currentLists = qc.getQueryData<List[]>(queryKeys.lists()) ?? []
      createListMut.mutate({ name, sortOrder: nextListSortOrder(currentLists) }, options)
    },
    [qc, createListMut],
  )

  // Non-optimistic: the server performs the deep copy (fresh slug,
  // isShared/isDraft reset) and returns the new row; invalidate + navigate.
  const duplicateMut = useMutation({
    mutationFn: (target: List) => duplicateList(target.id),
    meta: { errorToast: "Couldn't duplicate that list. Please try again." },
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: queryKeys.lists() })
      void navigate(`/lists/${created.id}`)
    },
  })

  const deleteListMut = useMutation({
    mutationFn: deleteList,
    ...makeOptimisticDelete<List, string>({
      qc,
      queryKey: queryKeys.lists(),
      id: (id) => id,
    }),
  })

  // Export a list's items to the Lighterpack-compatible CSV. Items and
  // categories resolve via fetchQuery (warm cache within staleTime,
  // fetched when cold) so the export works from any surface without that
  // list's items being mounted.
  const exportCsv = useCallback(
    async (list: List) => {
      setExportingListId(list.id)
      try {
        const [items, categories] = await Promise.all([
          qc.fetchQuery({
            queryKey: queryKeys.listItems(list.id),
            queryFn: () => fetchListItems(list.id),
          }),
          qc.fetchQuery({
            queryKey: queryKeys.categories(),
            queryFn: fetchCategories,
          }) as Promise<Category[]>,
        ])
        const csv = listItemsToCsv(items, categories)
        downloadCsv(
          `${list.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'list'}.csv`,
          csv,
        )
      } catch {
        // Non-optimistic action with no snap-back: surface feedback and
        // consume so the fire-and-forget call sites cannot reject.
        showToast("Couldn't export the list. Please try again.", { type: 'error' })
      } finally {
        setExportingListId((current) => (current === list.id ? null : current))
      }
    },
    [qc],
  )

  return { createListMut, submitCreateList, renameMut, duplicateMut, deleteListMut, exportCsv, exportingListId, draftMut }
}
