import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import {
  queryKeys,
  createList,
  nextListSortOrder,
  importCsvRowsToList,
  assertListImportWithinCaps,
  fetchLists,
  fetchGearItems,
  fetchCategories,
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
// Lists/gear/categories are resolved via fetchQuery (NOT getQueryData), so the
// hook is self-sufficient and does not depend on a page keeping those queries
// mounted. fetchQuery returns warm cache within the global 30s staleTime and
// fetches when the cache is cold or stale, so a cold-page import can never
// preflight caps or dedup gear/categories against empty arrays - treating
// missing inventory as [] would silently create duplicate gear and categories.
// Error routing is intentionally left to the caller: ListsPage and
// DesktopListsPanel surface failures through their own UI (import-error dialog
// vs. local state) via `.mutate(vars, { onError })`, so this hook declares no
// onError.
export function useListImportMutation(userId: string) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ name, rows }: { name: string; rows: ListImportRow[] }) => {
      // Resolve the inventory the import dedups and caps against. fetchQuery
      // guarantees real data (cached-if-fresh, fetched-if-missing); never [].
      const [lists, gearItems, categories] = await Promise.all([
        qc.fetchQuery<List[]>({ queryKey: queryKeys.lists(), queryFn: () => fetchLists(userId) }),
        qc.fetchQuery<GearItem[]>({ queryKey: queryKeys.gearItems(), queryFn: () => fetchGearItems(userId) }),
        qc.fetchQuery<Category[]>({ queryKey: queryKeys.categories(), queryFn: () => fetchCategories(userId) }),
      ])
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
