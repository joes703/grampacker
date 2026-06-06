import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import {
  queryKeys,
  createList,
  nextListSortOrder,
  importCsvRowsToList,
  assertListImportWithinCaps,
} from '../lib/queries'
import type { ListImportRow } from '../lib/csv'
import type { List, GearItem, Category } from '../lib/types'

// CSV-import-into-a-new-list mutation, shared by the lists surfaces
// (ListsPage card view and DesktopListsPanel in Phase 2). Reproduces the
// prior ListsPage importMut data flow exactly:
//
//   1. Preflight the per-list and inventory caps BEFORE any write, so a
//      rejected over-cap import leaves no orphan list or categories. This
//      ordering is load-bearing: assertListImportWithinCaps must run before
//      createList.
//   2. Create the list (append sort_order read from the live ['lists'] cache).
//   3. Populate it from the CSV rows.
//   4. On success, invalidate the three affected caches and navigate into
//      the new list so imported items are immediately visible.
//
// Gear/category inputs are read from the query cache at mutation time
// (matching duplicateMut/createListMut), not prop-drilled. Error routing is
// intentionally left to the caller: ListsPage and DesktopListsPanel surface
// failures through their own UI (import-error dialog vs. local state) via
// `.mutate(vars, { onError })`, so this hook declares no onError.
export function useListImportMutation(userId: string) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ name, rows }: { name: string; rows: ListImportRow[] }) => {
      const lists = qc.getQueryData<List[]>(queryKeys.lists()) ?? []
      const gearItems = qc.getQueryData<GearItem[]>(queryKeys.gearItems()) ?? []
      const categories = qc.getQueryData<Category[]>(queryKeys.categories()) ?? []
      // Preflight the caps BEFORE creating the list so a rejected over-cap
      // import leaves no orphan list or categories behind.
      assertListImportWithinCaps(rows, gearItems, categories)
      const newList = await createList(userId, name, nextListSortOrder(lists))
      await importCsvRowsToList(newList.id, userId, rows, gearItems, categories)
      return newList
    },
    onSuccess: (newList) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: queryKeys.categories() })
      navigate(`/lists/${newList.id}`)
    },
  })
}
