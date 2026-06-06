import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import {
  queryKeys,
  updateList,
  duplicateList,
  deleteList,
  fetchListItems,
  fetchCategories,
  makeOptimisticUpdate,
  makeOptimisticDelete,
  nextListSortOrder,
} from '../lib/queries'
import { listItemsToCsv, downloadCsv } from '../lib/csv'
import type { List, Category } from '../lib/types'

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
    },
    [qc, userId],
  )

  return { renameMut, duplicateMut, deleteListMut, exportCsv, draftMut }
}
