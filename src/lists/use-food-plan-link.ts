import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  attachFoodPlan,
  detachFoodPlan,
  makeOptimisticUpdate,
  queryKeys,
} from '../lib/queries'
import type { List } from '../lib/types'

// Attach / detach the food plan a list points at (food-planning-design.md 3).
//
// It lives here rather than in use-current-list-actions because its only
// surfaces are the list page's Food picker and the Food row's remove control -
// the /lists kebab and the List options popover have no use for it.
//
// The link is a LIVE REFERENCE, so both mutations write exactly ONE pointer on
// the list row: nothing is copied, and no food is touched.
//
// Optimistic on ['lists'] like renameMut - foodPlanId lives on the list row and
// there is no per-list metadata key. The weight then follows for free: the Food
// row derives from ['food-plan', id], so pointing at a different plan re-derives
// with no further invalidation.
//
// NOT invalidated: ['list-items']. Food is never a list_items row (section 4),
// so no membership changed.
//
// The ['shared-list'] prefix IS invalidated (design 5.5). It changes nothing
// today - the public DTO has no food object until slice 5 - but that is the
// slice where a share's headline weight starts including food, and the share
// cache has a 30s staleTime, so a previously-visited share in this same
// QueryClient would otherwise serve a total from before the plan changed.
//
// The ['food-plan'] prefix is invalidated too: each cached plan document
// carries usedByLists (the editor's 12.9 shared-plan warning), and attach is
// exactly the mutation that turns a one-list plan into an ambush. A stale
// cached document would suppress the warning the attach just made necessary.
export function useFoodPlanLink() {
  const qc = useQueryClient()

  const attachMut = useMutation({
    mutationFn: ({ id, foodPlanId }: { id: string; foodPlanId: string }) =>
      attachFoodPlan(id, foodPlanId),
    meta: { errorToast: "Couldn't attach that food plan. Please try again." },
    ...makeOptimisticUpdate<List, { id: string; foodPlanId: string }>({
      qc,
      queryKey: queryKeys.lists(),
      invalidateKeys: [queryKeys.sharedListAll(), queryKeys.foodPlanAll()],
      id: ({ id }) => id,
      apply: (item, { foodPlanId }) => ({
        ...item,
        foodPlanId,
        updatedAt: new Date().toISOString(),
      }),
    }),
  })

  const detachMut = useMutation({
    mutationFn: (id: string) => detachFoodPlan(id),
    meta: { errorToast: "Couldn't remove that food plan. Please try again." },
    ...makeOptimisticUpdate<List, string>({
      qc,
      queryKey: queryKeys.lists(),
      invalidateKeys: [queryKeys.sharedListAll(), queryKeys.foodPlanAll()],
      id: (id) => id,
      apply: (item) => ({
        ...item,
        foodPlanId: null,
        updatedAt: new Date().toISOString(),
      }),
    }),
  })

  return {
    attachMut,
    detachMut,
    // One in-flight link write at a time. Both mutations optimistically rewrite
    // the SAME field of the same row, so letting a second start before the first
    // settles lets the loser's response land last and win.
    busy: attachMut.isPending || detachMut.isPending,
  }
}
