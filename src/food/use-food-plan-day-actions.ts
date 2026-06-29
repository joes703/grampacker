import { useMutation } from '@tanstack/react-query'
import {
  addFoodPlanDay,
  deleteFoodPlanDay,
  duplicateFoodPlanDay,
  updateDayType,
  assertFoodPlanDayWithinCap,
  assertFoodPlanEntriesWithinCap,
} from '../lib/queries'
import type { FoodPlanDocument as Doc } from '../lib/types'
import { useFoodPlanView } from './useFoodPlanDocument'

// Day-level write paths for FoodPlanDocument, lifted out of the page component
// (the use-current-list-actions precedent) to start shrinking the god-file.
// This is the cleanest cluster to extract first: all four mutations settle
// through the same `invalidate` and close over no dialog/local state, so the
// move is purely mechanical - identical mutationFn bodies, error-toast meta,
// and onSuccess. The page keeps owning `invalidate`, `currentDoc`, and `view`
// and passes them in, exactly as the inline closures read them before.
export function useFoodPlanDayActions(
  userId: string,
  currentDoc: Doc,
  view: ReturnType<typeof useFoodPlanView>,
  invalidate: () => void,
) {
  const addDayMut = useMutation({
    mutationFn: () => {
      assertFoodPlanDayWithinCap(currentDoc.days.length)
      const sortOrder = currentDoc.days.reduce((m, d) => Math.max(m, d.sort_order + 1), 0)
      return addFoodPlanDay(userId, currentDoc.plan.id, sortOrder)
    },
    meta: { errorToast: "Couldn't add a day. Please try again." },
    onSuccess: invalidate,
  })
  const deleteDayMut = useMutation({
    mutationFn: (dayId: string) => deleteFoodPlanDay(dayId),
    meta: { errorToast: "Couldn't delete the day. Please try again." },
    onSuccess: invalidate,
  })
  const duplicateDayMut = useMutation({
    mutationFn: (dayId: string) => {
      // Duplicating a day adds one day AND copies all the source day's entries,
      // so it charges both caps.
      assertFoodPlanDayWithinCap(currentDoc.days.length)
      const sourceEntryCount = view.days
        .find((day) => day.day.id === dayId)
        ?.cells.reduce((total, cell) => total + cell.entries.length, 0) ?? 0
      assertFoodPlanEntriesWithinCap(currentDoc.entries.length, sourceEntryCount)
      const sortOrder = currentDoc.days.reduce((m, d) => Math.max(m, d.sort_order + 1), 0)
      // server copies the LIVE source day (schedule + entries) by id
      return duplicateFoodPlanDay(userId, dayId, sortOrder)
    },
    meta: { errorToast: "Couldn't duplicate the day. Please try again." },
    onSuccess: invalidate,
  })
  const dayTypeMut = useMutation({
    mutationFn: (v: { dayId: string; override: 'full' | 'partial' | null }) => updateDayType(v.dayId, v.override),
    meta: { errorToast: "Couldn't change the day type. Please try again." },
    onSuccess: invalidate,
  })

  return { addDayMut, deleteDayMut, duplicateDayMut, dayTypeMut }
}
