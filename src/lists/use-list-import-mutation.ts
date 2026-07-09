import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import {
  queryKeys,
  importListFromCsv,
  fetchGearItems,
  fetchCategories,
} from '../lib/queries'
import type { ListCsvRow } from '../lib/csv'
import {
  planListImport,
  assertListImportWithinCaps,
} from '../lib/csv/import-plan'
import type { GearItem, Category } from '../lib/types'

// CSV-import-into-a-new-list mutation, shared by the lists surfaces
// (ListsPage card view and DesktopListsPanel). The data flow:
//
//   1. Resolve the live gear/categories so the import plan dedups and
//      preflights caps against real inventory (never []).
//   2. Plan client-side (parse happened upstream; planListImport resolves
//      each row to existing library gear or a planned new entry), assert
//      the caps with the specific old-repo copy, then one POST - the
//      server creates the list + categories + gear + items atomically, so
//      a rejected over-cap import or a late DB failure leaves no orphan
//      rows behind.
//   3. On success, invalidate the three affected caches and navigate into
//      the new list so imported items are immediately visible.
//
// Gear/categories are resolved via fetchQuery (NOT getQueryData), so the
// hook is self-sufficient and does not depend on a page keeping those
// queries mounted. fetchQuery returns warm cache within the global
// staleTime and fetches when the cache is cold or stale - treating missing
// inventory as [] would silently create duplicate gear and categories.
// Error routing is intentionally left to the caller: ListsPage and
// DesktopListsPanel surface failures through their own UI (import-error
// dialog vs. local state) via `.mutate(vars, { onError })`, so this hook
// declares no onError.
export function useListImportMutation() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ name, rows }: { name: string; rows: ListCsvRow[] }) => {
      const [gearItems, categories] = await Promise.all([
        qc.fetchQuery<GearItem[]>({ queryKey: queryKeys.gearItems(), queryFn: fetchGearItems }),
        qc.fetchQuery<Category[]>({ queryKey: queryKeys.categories(), queryFn: fetchCategories }),
      ])
      const plan = planListImport(rows, categories, gearItems)
      // Cap preflight BEFORE the POST: the server would 422 anyway, but
      // these messages are specific and actionable where the server's are
      // generic limit errors.
      assertListImportWithinCaps(plan, gearItems.length)
      return importListFromCsv({
        name,
        categories: plan.newCategories,
        gear: plan.newGear,
        items: plan.items,
      })
    },
    onSuccess: (newList) => {
      void qc.invalidateQueries({ queryKey: queryKeys.lists() })
      void qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      void qc.invalidateQueries({ queryKey: queryKeys.categories() })
      void navigate(`/lists/${newList.id}`)
    },
  })
}
