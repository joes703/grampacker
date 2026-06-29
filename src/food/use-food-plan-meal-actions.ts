import { useMutation } from '@tanstack/react-query'
import {
  addMealDefinition, deleteMeal, deleteDayMeal, addDayMeal, assertMealDefinitionWithinCap,
} from '../lib/queries'
import type { FoodPlanDocument as Doc } from '../lib/types'

// Toggling a single schedule cell on/off. Defined here rather than imported from
// ScheduleGridDialog so the action layer does not depend on a dialog module; the
// dialog's own ScheduleToggle is structurally identical, so its onToggle payload
// flows straight into toggleCellMut.mutate. (Mirrors the entry hook keeping its
// own EntryAmount/MoveCopy input types - PR #145.)
export type ScheduleToggle = { dayId: string; mealId: string; on: boolean; dayMealId?: string }

// Meal-definition + schedule write paths for FoodPlanDocument, lifted out of the
// page component following use-food-plan-day-actions (PR #140) and
// use-food-plan-entry-actions (PR #145). F3 slice 2: the meal/schedule cluster -
// add/omit/restore/delete a meal and toggle a single schedule cell, plus the
// meal-definition cap check. The page keeps owning `invalidate` and `currentDoc`
// and passes them in, exactly as the inline closures read them before.
//
// The only dialog this cluster backs is the add-meal dialog; its close stays
// local at the call site via mutate-time onSuccess, behavior-identical to the
// previous inline `onSuccess: () => { setShowAddMeal(false); return invalidate() }`
// because invalidateFoodPlanCaches is synchronous and returns void - it fires the
// invalidation without awaiting a refetch, so closing the dialog just before vs
// just after that synchronous call schedules the same single React flush.
export function useFoodPlanMealActions(
  userId: string,
  currentDoc: Doc,
  invalidate: () => void,
) {
  const addMealMut = useMutation({
    mutationFn: (name: string) => {
      assertMealDefinitionWithinCap(currentDoc.meals.length)
      const sortOrder = currentDoc.meals.reduce((m, x) => Math.max(m, x.sort_order + 1), 0)
      return addMealDefinition(userId, currentDoc.plan.id, name, sortOrder)
    },
    meta: { errorToast: "Couldn't add the meal. Please try again." },
    onSuccess: invalidate,
  })
  const omitMealMut = useMutation({
    mutationFn: (dayMealId: string) => deleteDayMeal(dayMealId),
    meta: { errorToast: "Couldn't omit the meal. Please try again." },
    onSuccess: invalidate,
  })
  const restoreMealMut = useMutation({
    mutationFn: (v: { dayId: string; mealId: string }) => addDayMeal(userId, currentDoc.plan.id, v.dayId, v.mealId),
    meta: { errorToast: "Couldn't restore the meal. Please try again." },
    onSuccess: invalidate,
  })
  const deleteMealMut = useMutation({
    mutationFn: (mealId: string) => deleteMeal(mealId),
    meta: { errorToast: "Couldn't delete the meal. Please try again." },
    onSuccess: invalidate,
  })
  const toggleCellMut = useMutation({
    mutationFn: async (v: ScheduleToggle) => {
      if (v.on) {
        await addDayMeal(userId, currentDoc.plan.id, v.dayId, v.mealId)
      } else {
        await deleteDayMeal(v.dayMealId ?? '')
      }
    },
    meta: { errorToast: "Couldn't update the schedule. Please try again." },
    onSuccess: invalidate,
  })

  return { addMealMut, omitMealMut, restoreMealMut, deleteMealMut, toggleCellMut }
}
