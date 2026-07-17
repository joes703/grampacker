import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  createFoodPlan,
  deleteFoodPlan,
  duplicateFoodPlan,
  makeOptimisticDelete,
  type FoodPlanDocument,
  type FoodPlanSummary,
} from '../lib/queries'
import type { CreateFoodPlanRequestInput } from '../../shared/food-plans'

// Index-page write actions for FoodPlansPage: create, duplicate and delete,
// operating on the ['food-plans'] summary-list cache.
//
// create and duplicate return the FRESH plan document. We seed the
// ['food-plan', id] cache with it so the editor the page navigates to renders
// immediately (no loading flash on a plan we just built), then invalidate the
// summary list so the new card appears. create's errors surface inline in the
// create dialog (the cap 422) - so no errorToast there; duplicate has no
// dialog, so it toasts.
//
// duplicate is the reuse primitive under one-plan-per-trip ("want another
// plan? create new or duplicate"): a plain library copy, attached to nothing
// (the listId-carrying variant lives in use-food-plan-link, where the picker
// needs its CAS semantics). No list moved, so ['lists'] and shares stay put.
//
// delete uses the generic single-cache optimistic helper (design 5.5 rules out a
// gear-style fan-out): a plan lives only in these two caches and the row vanishes
// from the list instantly, with an errorToast to make a rollback visible.
export function useFoodPlanActions() {
  const qc = useQueryClient()

  const createPlan = useMutation({
    mutationFn: (input: CreateFoodPlanRequestInput) => createFoodPlan(input),
    onSuccess: (doc: FoodPlanDocument) => {
      qc.setQueryData(queryKeys.foodPlan(doc.id), doc)
      void qc.invalidateQueries({ queryKey: queryKeys.foodPlans() })
    },
  })

  const duplicatePlan = useMutation({
    mutationFn: (id: string) => duplicateFoodPlan(id, null, null),
    meta: { errorToast: "Couldn't duplicate the plan. Please try again." },
    onSuccess: (doc: FoodPlanDocument) => {
      qc.setQueryData(queryKeys.foodPlan(doc.id), doc)
      void qc.invalidateQueries({ queryKey: queryKeys.foodPlans() })
    },
  })

  const removePlan = useMutation({
    mutationFn: (id: string) => deleteFoodPlan(id),
    ...makeOptimisticDelete<FoodPlanSummary, string>({
      qc,
      queryKey: queryKeys.foodPlans(),
      id: (id) => id,
      errorToast: "Couldn't delete the plan. Please try again.",
    }),
    // The optimistic helper only touches the ['food-plans'] summary list. The
    // deleted plan's DOCUMENT cache (['food-plan', id]) would otherwise survive,
    // so a back-navigation to /food/plans/:id could render the just-deleted plan
    // straight from cache (inside the 30s staleTime, with no refetch; and even a
    // 404 refetch leaves TanStack's previous data in place). Evict it so the
    // editor shows the not-found state instead. onSuccess (not onSettled) so a
    // failed delete keeps the document.
    //
    // Deleting a plan also DETACHES every list pointing at it: lists.food_plan_id
    // is a NO ACTION reference, so the repo nulls it server-side first
    // (server/repos/food-plans.ts). That makes ['lists'] and any share cache stale
    // in a way the user sees - a cached list would keep its dead foodPlanId,
    // request the deleted plan, and show a load-error banner where its food row
    // used to be. Invalidate both; we cannot know which lists moved without
    // re-reading them, and refetchOnWindowFocus is off, so nothing else would.
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: queryKeys.foodPlan(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.lists() })
      void qc.invalidateQueries({ queryKey: queryKeys.sharedListAll() })
    },
  })

  return { createPlan, duplicatePlan, removePlan }
}
