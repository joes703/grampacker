import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import {
  queryKeys,
  nextListSortOrder,
  importListFromCsv,
  fetchLists,
  fetchGearItems,
  fetchCategories,
} from '../lib/queries'
import type { ListImportRow } from '../lib/csv'
import type { List, GearItem, Category } from '../lib/types'

// CSV-import-into-a-new-list mutation, shared by the lists surfaces
// (ListsPage card view and DesktopListsPanel in Phase 2). The data flow:
//
//   1. Resolve the live lists/gear/categories so the import dedups, caps,
//      and sort_order are computed against real inventory (never []).
//   2. Hand off to importListFromCsv, which preflights the per-list and
//      inventory caps and then commits the new list + categories + gear +
//      items in a single atomic RPC (Stage 10 / C-05). A rejected over-cap
//      import or a late DB failure leaves no orphan rows behind.
//   3. On success, invalidate the three affected caches and navigate into
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
      // importListFromCsv runs the cap preflight BEFORE the RPC and commits the
      // list + categories + gear + items atomically, so a rejected or failed
      // import leaves no orphan list/categories/gear behind.
      return importListFromCsv(userId, name, rows, gearItems, categories, nextListSortOrder(lists))
    },
    onSuccess: (newList) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: queryKeys.categories() })
      navigate(`/lists/${newList.id}`)
    },
  })
}
