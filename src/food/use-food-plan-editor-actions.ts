import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  renameFoodPlan,
  addFoodPlanDay,
  removeFoodPlanDay,
  addFoodPlanMeal,
  removeFoodPlanMeal,
  addFoodPlanEntry,
  updateFoodPlanEntry,
  removeFoodPlanEntry,
  duplicateFoodPlan,
  type FoodPlanDocument,
} from '../lib/queries'
import type {
  AddEntryRequestInput,
  UpdateEntryRequest,
} from '../../shared/food-plans'

// Editor write actions for FoodPlanEditor, all keyed to one plan.
//
// Every server mutation returns the fresh plan document from a single batched
// read, so success handling is uniform and deliberately un-clever: write the
// returned document straight into the ['food-plan', id] cache and let the view
// re-derive (design 5.5 - the editor is a pure projection of this one entry, NOT
// a hand-maintained optimistic graph). The summary list is invalidated too
// because a day/entry/name change moves its counts and title.
//
// No optimistic updates: a structural graph edit (add day => a new grid row of
// cells) is far too fiddly to reconstruct correctly on the client, and the whole
// point of returning the document is to avoid it. The round-trip is one small
// request; a brief pending state on the specific control is the honest UX.
//
// Because each success blindly overwrites the cache with its response document,
// two mutations in flight at once could land out of order and clobber the newer
// document with an older snapshot. FoodPlanEditor prevents that by disabling
// every write trigger while any of these mutations is pending (its `busy` gate),
// so at most one is ever in flight - the single-user serialization the design
// calls for (6/12.3).
export function useFoodPlanEditorActions(planId: string) {
  const qc = useQueryClient()

  function onDoc(doc: FoodPlanDocument) {
    qc.setQueryData(queryKeys.foodPlan(planId), doc)
    void qc.invalidateQueries({ queryKey: queryKeys.foodPlans() })
  }

  const rename = useMutation({
    mutationFn: (name: string) => renameFoodPlan(planId, name),
    onSuccess: onDoc,
  })

  const addDay = useMutation({
    mutationFn: () => addFoodPlanDay(planId),
    onSuccess: onDoc,
  })

  const removeDay = useMutation({
    mutationFn: (dayId: string) => removeFoodPlanDay(planId, dayId),
    onSuccess: onDoc,
  })

  const addMeal = useMutation({
    mutationFn: (name: string) => addFoodPlanMeal(planId, name),
    onSuccess: onDoc,
  })

  const removeMeal = useMutation({
    mutationFn: (mealId: string) => removeFoodPlanMeal(planId, mealId),
    onSuccess: onDoc,
  })

  const addEntry = useMutation({
    mutationFn: (input: AddEntryRequestInput) =>
      addFoodPlanEntry(planId, input),
    onSuccess: onDoc,
  })

  const updateEntry = useMutation({
    mutationFn: ({
      entryId,
      patch,
    }: {
      entryId: string
      patch: UpdateEntryRequest
    }) => updateFoodPlanEntry(planId, entryId, patch),
    onSuccess: onDoc,
  })

  const removeEntry = useMutation({
    mutationFn: (entryId: string) => removeFoodPlanEntry(planId, entryId),
    onSuccess: onDoc,
  })

  // "Duplicate for this trip" (design 12.9): the server deep-copies the plan
  // and re-points listId at the copy in one transaction. The response is the
  // NEW plan's document, so it does NOT go through onDoc (which would write it
  // over the CURRENT plan's cache entry) - it seeds the copy's own entry, and
  // the caller navigates there. The SOURCE document is invalidated because the
  // fork just shrank its usedByLists: navigating back within staleTime would
  // otherwise re-show the shared-plan warning for a list that already left.
  // ['lists'] because the fork moved the arriving list's foodPlanId;
  // ['shared-list'] for the same reason attach invalidates it; the summary
  // list gains a card.
  const duplicate = useMutation({
    mutationFn: (listId: string | null) => duplicateFoodPlan(planId, listId),
    onSuccess: (doc: FoodPlanDocument) => {
      qc.setQueryData(queryKeys.foodPlan(doc.id), doc)
      void qc.invalidateQueries({ queryKey: queryKeys.foodPlan(planId) })
      void qc.invalidateQueries({ queryKey: queryKeys.foodPlans() })
      void qc.invalidateQueries({ queryKey: queryKeys.lists() })
      void qc.invalidateQueries({ queryKey: queryKeys.sharedListAll() })
    },
  })

  return {
    rename,
    addDay,
    removeDay,
    addMeal,
    removeMeal,
    addEntry,
    updateEntry,
    removeEntry,
    duplicate,
  }
}
