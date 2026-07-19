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
  setFoodPlanDayType,
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
    // The public share of the list this plan backs carries a SERVER-computed
    // weight (slice 5), so no client-side derivation heals it after an edit.
    // Design 5.5: entry mutations invalidate the ['shared-list'] prefix -
    // the share cache's 30s staleTime would otherwise serve the old total to
    // an owner revisiting their own share. Coarse on purpose (5.5): rename
    // and day/meal edits ride along rather than earning a per-mutation split.
    void qc.invalidateQueries({ queryKey: queryKeys.sharedListAll() })
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

  const setDayType = useMutation({
    mutationFn: ({
      dayId,
      dayTypeOverride,
    }: {
      dayId: string
      dayTypeOverride: 'full' | 'partial' | null
    }) => setFoodPlanDayType(planId, dayId, dayTypeOverride),
    onSuccess: onDoc,
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
    setDayType,
  }
}
