import { useMutation, type QueryClient } from '@tanstack/react-query'
import {
  queryKeys, saveFoodPlanTargets, deleteFoodPlan, invalidateFoodPlanCaches, type TargetsSavePayload,
} from '../lib/queries'
import type { FoodPlanDocument as Doc } from '../lib/types'

// Plan-level write paths for FoodPlanDocument, lifted out of the page component
// following the day (PR #140), entry (PR #145), and meal (PR #146) hooks. F3
// slice 3: the two mutations that operate on the plan as a whole - save the
// plan's targets and delete the entire plan.
//
// Unlike the sibling hooks this one takes the QueryClient: deletePlanMut needs
// direct cache invalidation beyond the shared `invalidate` callback (it also
// clears the food pack state and this user's food-plan copy options), so it can't
// be expressed through `invalidate` alone. saveTargetsMut uses the shared
// callback exactly as before.
//
// The dialogs these back (Targets, the delete confirm) stay owned by the page;
// each closes at its mutate call site via mutate-time onSuccess, behavior-
// identical to the previous inline close-then-invalidate because the invalidation
// is synchronous (invalidateFoodPlanCaches returns void and the invalidateQueries
// promises are not awaited), so closing just before vs just after it schedules
// the same single React flush.
export function useFoodPlanPlanActions({
  userId,
  listId,
  currentDoc,
  queryClient,
  invalidate,
}: {
  userId: string
  listId: string
  currentDoc: Doc
  queryClient: QueryClient
  invalidate: () => void
}) {
  const saveTargetsMut = useMutation({
    mutationFn: (p: TargetsSavePayload) => saveFoodPlanTargets(userId, currentDoc.plan.id, p),
    meta: { errorToast: "Couldn't save targets. Please try again." },
    onSuccess: invalidate,
  })

  // Delete the whole food plan. The DB cascades this plan's meals, days,
  // day_meals, entries, daily/meal targets, and packed-food state; food_items
  // (the library), the gear list, and gear are referenced the other way and are
  // left untouched. On success we refresh the plan + pack caches so the page
  // falls back to the empty state, plus the copy-options lists where this plan
  // was offered as a source for other lists.
  const deletePlanMut = useMutation({
    mutationFn: () => deleteFoodPlan(currentDoc.plan.id),
    meta: { errorToast: "Couldn't delete the food plan. Please try again." },
    onSuccess: () => {
      invalidateFoodPlanCaches(queryClient, listId)
      queryClient.invalidateQueries({ queryKey: queryKeys.foodPackState(listId) })
      // Prefix match: invalidate this user's copy-options for every target list.
      queryClient.invalidateQueries({ queryKey: ['food-plan-copy-options', userId] })
    },
  })

  return { saveTargetsMut, deletePlanMut }
}
