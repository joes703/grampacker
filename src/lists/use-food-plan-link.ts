import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  attachFoodPlan,
  detachFoodPlan,
  duplicateFoodPlan,
  makeOptimisticUpdate,
  queryKeys,
} from '../lib/queries'
import { ApiError } from '../lib/api'
import { showToast } from '../lib/toast'
import type { List } from '../lib/types'

// Attach / detach / duplicate-and-attach the food plan a list points at
// (food-planning-design.md 3, one-plan-per-trip).
//
// It lives here rather than in use-current-list-actions because its only
// surfaces are the list page's Food picker and the Food row's remove control -
// the /lists kebab and the List options popover have no use for it.
//
// The link is a LIVE REFERENCE, so attach/detach write exactly ONE pointer on
// the list row: nothing is copied, and no food is touched. Duplicate & attach
// is the one that copies - it is how a plan already backing ANOTHER list is
// reused, since a plan backs at most one list.
//
// Attach/detach are optimistic on ['lists'] like renameMut - foodPlanId lives
// on the list row and there is no per-list metadata key. The weight then
// follows for free: the Food row derives from ['food-plan', id], so pointing
// at a different plan re-derives with no further invalidation.
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
// carries usedByList (the editor's "Used by <list>" breadcrumb), and every
// mutation here moves some plan's link.
//
// The ['food-pack'] prefix is REMOVED, not invalidated, on every
// successful link move: rule 1 cleared the rows server-side, and
// invalidated data is still rendered while its refetch is in flight, so
// detach-then-reattach of the SAME plan would paint the cleared checkmarks
// as phantom pre-checks from the retained cache entry (the plan-id-keyed
// cache only protects across DIFFERENT plans). Removal drops the data
// outright; the checklist (disabled outside pack mode, so never actively
// observed here) refetches from scratch on next entry.
export function useFoodPlanLink() {
  const qc = useQueryClient()

  // Composed manually (not meta.errorToast: the global handler would fire it
  // for EVERY failure) so a 409 - the plan is already on another list, e.g.
  // attached from a second tab after this picker rendered - gets its own
  // message plus a summaries refetch that flips the row to its in-use state,
  // while other failures keep the generic copy. Exactly one toast either way.
  const attachOptimistic = makeOptimisticUpdate<
    List,
    { id: string; foodPlanId: string }
  >({
    qc,
    queryKey: queryKeys.lists(),
    invalidateKeys: [
      queryKeys.sharedListAll(),
      queryKeys.foodPlanAll(),
      // The summaries' usedByListId/Name just moved - a stale Plans index
      // (or another list's picker) would offer the wrong action for this plan.
      queryKeys.foodPlans(),
    ],
    id: ({ id }) => id,
    apply: (item, { foodPlanId }) => ({
      ...item,
      foodPlanId,
      updatedAt: new Date().toISOString(),
    }),
  })
  const attachMut = useMutation({
    mutationFn: ({ id, foodPlanId }: { id: string; foodPlanId: string }) =>
      attachFoodPlan(id, foodPlanId),
    ...attachOptimistic,
    onSuccess: () => {
      qc.removeQueries({ queryKey: queryKeys.foodPackStateAll() })
    },
    onError: (error, vars, ctx) => {
      attachOptimistic.onError(error, vars, ctx)
      if (error instanceof ApiError && error.status === 409) {
        showToast('That plan is already used by another list.', {
          type: 'error',
        })
        void qc.invalidateQueries({ queryKey: queryKeys.foodPlans() })
      } else {
        showToast("Couldn't attach that food plan. Please try again.", {
          type: 'error',
        })
      }
    },
  })

  const detachMut = useMutation({
    mutationFn: (id: string) => detachFoodPlan(id),
    meta: { errorToast: "Couldn't remove that food plan. Please try again." },
    ...makeOptimisticUpdate<List, string>({
      qc,
      queryKey: queryKeys.lists(),
      invalidateKeys: [
        queryKeys.sharedListAll(),
        queryKeys.foodPlanAll(),
        queryKeys.foodPlans(), // same as attach: usedByList* just changed
      ],
      id: (id) => id,
      apply: (item) => ({
        ...item,
        foodPlanId: null,
        updatedAt: new Date().toISOString(),
      }),
    }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: queryKeys.foodPackStateAll() })
    },
  })

  // "Duplicate & attach": the picker's action for a plan already backing
  // another list. The server deep-copies the plan and re-points THIS list at
  // the copy in one transaction, the attach a CAS on the link this client
  // observed (expectedFoodPlanId). Not optimistic - there is no copy to point
  // at until the server mints one; the picker shows its busy state instead.
  //
  // Success seeds the copy's document (opening it renders without a loading
  // flash) and invalidates: the replaced plan's document if there was one
  // (its usedByList just lost this list), the summaries (a new card, and
  // usedByList* moved), ['lists'] (this list's foodPlanId moved), and
  // ['shared-list'] for the same slice-5 reason as attach. Failure - the CAS
  // lost, or anything else - refetches summaries + lists so a stale picker
  // resyncs to whatever actually holds the plan now.
  const duplicateMut = useMutation({
    mutationFn: ({
      planId,
      listId,
      expectedFoodPlanId,
    }: {
      planId: string
      listId: string
      expectedFoodPlanId: string | null
    }) => duplicateFoodPlan(planId, listId, expectedFoodPlanId),
    meta: {
      errorToast: "Couldn't duplicate that food plan. Please try again.",
    },
    onSuccess: (doc, vars) => {
      qc.setQueryData(queryKeys.foodPlan(doc.id), doc)
      if (vars.expectedFoodPlanId !== null) {
        void qc.invalidateQueries({
          queryKey: queryKeys.foodPlan(vars.expectedFoodPlanId),
        })
      }
      void qc.invalidateQueries({ queryKey: queryKeys.foodPlans() })
      void qc.invalidateQueries({ queryKey: queryKeys.lists() })
      void qc.invalidateQueries({ queryKey: queryKeys.sharedListAll() })
      qc.removeQueries({ queryKey: queryKeys.foodPackStateAll() })
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.foodPlans() })
      void qc.invalidateQueries({ queryKey: queryKeys.lists() })
    },
  })

  return {
    attachMut,
    detachMut,
    duplicateMut,
    // One in-flight link write at a time. All three mutations end by moving
    // the SAME pointer on the same row, so letting a second start before the
    // first settles lets the loser's response land last and win.
    busy: attachMut.isPending || detachMut.isPending || duplicateMut.isPending,
  }
}
