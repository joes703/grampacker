import { useCallback } from 'react'
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
import { showToast } from '../lib/toast'
import { optimisticListPlaceholder } from '../lib/optimistic-list-placeholder'
import type { List, Category } from '../lib/types'

// createListMut variables: the name plus the append sort_order snapshotted at
// submit time. Carried together so the optimistic placeholder and the server
// write share one immutable per-invocation value (see submitCreateList).
type CreateListVars = { name: string; sortOrder: number }

// Shared current-list actions hook. Both the /lists card kebab
// (ListsPage) and the in-list List options popover/modal
// (ListSettingsPanel) call this to get the same rename / duplicate /
// delete / exportCsv handlers. Same mutations, same write paths, same
// optimistic-update shapes - one canonical code path, multiple entry
// points.
//
// Sort-order semantics on duplicate: append to the end. The hook reads
// the current lists cache at mutation time rather than taking a stale
// `listsLength` snapshot, so duplications stay correct even if other
// mutations have changed the count since this hook last ran.
//
// Export CSV semantics: fetch-or-cache list items and categories at
// click time (qc.fetchQuery returns cached data if present, otherwise
// performs the fetch). The filename mirrors ListsPage's prior local
// handler so the user-visible behavior is unchanged.
export function useCurrentListActions(userId: string) {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateList(id, { name }),
    ...makeOptimisticUpdate<List, { id: string; name: string }>({
      qc,
      queryKey: queryKeys.lists(),
      id: ({ id }) => id,
      apply: (item, { name }) => ({
        ...item,
        name,
        updated_at: new Date().toISOString(),
      }),
    }),
  })

  // Toggle a list between draft (still being built) and complete. Label
  // only - never locks editing. Optimistic on the ['lists'] cache; is_draft
  // does not affect list_items, so no ['list-items'] invalidation. Shared by
  // CurrentListHeader (the clickable "Mark list complete" pill) and
  // ListSettingsPanel (the Draft toggle).
  const draftMut = useMutation({
    mutationFn: (target: List) => updateList(target.id, { is_draft: !target.is_draft }),
    ...makeOptimisticUpdate<List, List>({
      qc,
      queryKey: queryKeys.lists(),
      id: (target) => target.id,
      apply: (item) => ({
        ...item,
        is_draft: !item.is_draft,
        updated_at: new Date().toISOString(),
      }),
    }),
  })

  // Create a new list. The append sort_order is captured ONCE per invocation -
  // in submitCreateList below, from the pre-insert ['lists'] cache - and passed
  // as an immutable mutation variable, so the optimistic placeholder and the
  // server write consume the exact same value. This matters because
  // makeOptimisticInsert.onMutate appends the placeholder to the cache BEFORE
  // mutationFn runs; if mutationFn recomputed the position from the cache it
  // would count that placeholder and persist a sort_order one position too
  // high. Threading the value through the variables (rather than a shared ref)
  // also keeps two near-simultaneous creates from corrupting each other's
  // value. (duplicateMut reads the cache in its mutationFn safely because it
  // has no optimistic insert polluting it.)
  const createListMut = useMutation({
    mutationFn: ({ name, sortOrder }: CreateListVars) => createList(userId, name, sortOrder),
    ...makeOptimisticInsert<List, CreateListVars>({
      qc,
      queryKey: queryKeys.lists(),
      optimistic: ({ name, sortOrder }) => optimisticListPlaceholder({ name, userId, sortOrder }),
    }),
    onSuccess: (created) => navigate(`/lists/${created.id}`),
  })

  // Hook-owned submit wrapper: snapshot the append sort_order from the live
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

  const duplicateMut = useMutation({
    mutationFn: (target: List) => {
      const currentLists = qc.getQueryData<List[]>(queryKeys.lists()) ?? []
      return duplicateList(target, userId, nextListSortOrder(currentLists))
    },
    meta: { errorToast: "Couldn't duplicate that list. Please try again." },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      navigate(`/lists/${created.id}`)
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

  const exportCsv = useCallback(
    async (list: List) => {
      try {
        const [items, categories] = await Promise.all([
          qc.fetchQuery({
            queryKey: queryKeys.listItems(list.id),
            queryFn: () => fetchListItems(list.id, userId),
          }),
          qc.fetchQuery({
            queryKey: queryKeys.categories(),
            queryFn: () => fetchCategories(userId),
          }) as Promise<Category[]>,
        ])
        const csv = listItemsToCsv(items, categories)
        downloadCsv(
          `${list.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'list'}.csv`,
          csv,
        )
      } catch {
        // Non-optimistic action with no snap-back: surface feedback and consume
        // so the fire-and-forget call sites cannot reject.
        showToast("Couldn't export the list. Please try again.", { type: 'error' })
      }
    },
    [qc, userId],
  )

  return { createListMut, submitCreateList, renameMut, duplicateMut, deleteListMut, exportCsv, draftMut }
}
