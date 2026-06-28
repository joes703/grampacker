import { useMutation } from '@tanstack/react-query'
import {
  upsertFoodPlanEntry, upsertFoodPlanEntries, updateFoodPlanEntry, deleteFoodPlanEntry,
  assertFoodPlanEntryWithinCap, type EntryAddition,
} from '../lib/queries'
import { randomTempId } from '../lib/random-temp-id'
import type { EntryBasis, FoodItem, FoodPlanEntry, FoodPlanDocument as Doc } from '../lib/types'
import type { EntryAmountResult } from './EntryAmountDialog'
import type { MoveCopyTarget } from './MoveCopyEntryDialog'

// Where a new/edited entry lands: a scheduled cell (its day_meal row) or the
// plan-wide Extras bucket. Lives here because every entry-write path keys off it
// and FoodPlanDocument now imports it back for its add-dialog state.
export type AddTarget = { kind: 'cell'; dayMealId: string } | { kind: 'extra' }

// Entry-level write paths for FoodPlanDocument, lifted out of the page component
// following the use-food-plan-day-actions precedent (PR #140) to keep shrinking
// the god-file. This is the next coherent cluster after the day actions: the four
// entry mutations (add/upsert, edit basis+amount, delete, move/copy) plus the
// pure entry-domain queries they share (entryAtTarget / existingEntry /
// nextEntrySort) and the entry cap checks.
//
// The page keeps owning `invalidate`, `currentDoc`, and the dialog open/close
// state and passes the first two in, exactly as the inline closures read them
// before. Dialog state stays local: the add/edit/move-copy dialogs close at the
// mutate call site via mutate-time `onSuccess`, the same shape the day hook uses
// for its delete-day confirm. That is behavior-identical to the previous inline
// `onSuccess: () => { setDialog(null); return invalidate() }` because
// `invalidateFoodPlanCaches` is synchronous and returns void - it fires the
// invalidation without awaiting a refetch, so closing just before vs just after
// that synchronous call schedules the same single React flush either way.
//
// `existingEntry` is returned because the page still needs it outside a mutation,
// to feed the add dialog's `existing` prop; keeping it here is the single source
// of truth for "is this food already in that target".
export function useFoodPlanEntryActions(
  userId: string,
  currentDoc: Doc,
  invalidate: () => void,
) {
  function entryAtTarget(foodId: string, target: AddTarget) {
    return currentDoc.entries.find((e) =>
      e.food_item_id === foodId &&
      (target.kind === 'extra' ? e.is_extra : !e.is_extra && e.day_meal_id === target.dayMealId))
  }
  function existingEntry(food: FoodItem, target: AddTarget) {
    return entryAtTarget(food.id, target)
  }
  function nextEntrySort(target: AddTarget): number {
    const siblings = currentDoc.entries.filter((e) =>
      target.kind === 'extra' ? e.is_extra : e.day_meal_id === target.dayMealId)
    return siblings.reduce((max, e) => Math.max(max, e.sort_order + 1), 0)
  }

  const addMut = useMutation({
    mutationFn: async (v: { food: FoodItem; target: AddTarget; result: EntryAmountResult }) => {
      const targets: AddTarget[] = v.target.kind === 'cell'
        ? [v.target, ...v.result.alsoDayMealIds.map((id) => ({ kind: 'cell' as const, dayMealId: id }))]
        : [v.target]
      const newCount = targets.filter((t) => !existingEntry(v.food, t)).length
      if (newCount > 0) {
        assertFoodPlanEntryWithinCap(currentDoc.entries.length + newCount - 1)
      }
      const additions = targets.map((t) => {
        const prior = existingEntry(v.food, t)
        const addition: EntryAddition = {
          id: randomTempId(), food_plan_id: currentDoc.plan.id,
          day_meal_id: t.kind === 'cell' ? t.dayMealId : null,
          is_extra: t.kind === 'extra', food_item_id: v.food.id,
          basis: v.result.basis, amount: v.result.amount,
          sort_order: prior?.sort_order ?? nextEntrySort(t),
        }
        return { entry: addition, preserve_basis: v.result.preserveBasis }
      })
      await upsertFoodPlanEntries(userId, additions)
    },
    meta: { errorToast: "Couldn't add the food. Please try again." },
    onSuccess: invalidate,
  })

  const editMut = useMutation({
    mutationFn: (v: { id: string; basis: EntryBasis; amount: number }) =>
      updateFoodPlanEntry(v.id, { basis: v.basis, amount: v.amount }),
    meta: { errorToast: "Couldn't update the food. Please try again." },
    onSuccess: invalidate,
  })

  const removeMut = useMutation({
    mutationFn: (id: string) => deleteFoodPlanEntry(id),
    meta: { errorToast: "Couldn't remove the food. Please try again." },
    onSuccess: invalidate,
  })

  const moveCopyMut = useMutation({
    mutationFn: (v: { entry: FoodPlanEntry; target: MoveCopyTarget; preserveBasis: EntryBasis | null; isMove: boolean }) => {
      if (!v.isMove && !entryAtTarget(v.entry.food_item_id, v.target)) {
        assertFoodPlanEntryWithinCap(currentDoc.entries.length)
      }
      const addition: EntryAddition = {
        id: randomTempId(), food_plan_id: currentDoc.plan.id,
        day_meal_id: v.target.kind === 'cell' ? v.target.dayMealId : null,
        is_extra: v.target.kind === 'extra',
        food_item_id: v.entry.food_item_id, basis: v.entry.basis, amount: v.entry.amount,
        // append at the destination (ignored by the server on a merge)
        sort_order: nextEntrySort(v.target),
      }
      return upsertFoodPlanEntry(userId, addition, v.preserveBasis, v.isMove ? v.entry.id : null)
    },
    meta: { errorToast: "Couldn't move or copy the food. Please try again." },
    onSuccess: invalidate,
  })

  return { addMut, editMut, removeMut, moveCopyMut, existingEntry }
}
