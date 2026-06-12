import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys, fetchFoodItems,
  upsertFoodPlanEntry, updateFoodPlanEntry, deleteFoodPlanEntry,
  assertFoodPlanEntryWithinCap, type EntryAddition,
} from '../lib/queries'
import { randomTempId } from '../lib/random-temp-id'
import type { EntryBasis, FoodItem, FoodPlanDocument as Doc } from '../lib/types'
import { useFoodPlanView } from './useFoodPlanDocument'
import FoodPlanDayCard from './FoodPlanDayCard'
import FoodPlanExtras from './FoodPlanExtras'
import FoodPicker from './FoodPicker'
import EntryAmountDialog, { type EntryAmountResult } from './EntryAmountDialog'

type AddTarget = { kind: 'cell'; dayMealId: string } | { kind: 'extra' }

export default function FoodPlanDocument({ listId, userId, doc }: { listId: string; userId: string; doc: Doc }) {
  const view = useFoodPlanView(doc)
  const foodsQuery = useQuery({ queryKey: queryKeys.foodItems(), queryFn: () => fetchFoodItems(userId) })
  const foodById = new Map<string, FoodItem>((foodsQuery.data ?? []).map((f) => [f.id, f]))

  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.foodPlan(listId) })

  const [addTarget, setAddTarget] = useState<AddTarget | null>(null)
  const [pickedFood, setPickedFood] = useState<FoodItem | null>(null)
  const [editEntryId, setEditEntryId] = useState<string | null>(null)

  function existingEntry(food: FoodItem, target: AddTarget) {
    return doc.entries.find((e) =>
      e.food_item_id === food.id &&
      (target.kind === 'extra' ? e.is_extra : !e.is_extra && e.day_meal_id === target.dayMealId))
  }
  function nextEntrySort(target: AddTarget): number {
    const siblings = doc.entries.filter((e) =>
      target.kind === 'extra' ? e.is_extra : e.day_meal_id === target.dayMealId)
    return siblings.reduce((max, e) => Math.max(max, e.sort_order + 1), 0)
  }

  const addMut = useMutation({
    mutationFn: (v: { food: FoodItem; target: AddTarget; result: EntryAmountResult }) => {
      const prior = existingEntry(v.food, v.target)
      if (!prior) assertFoodPlanEntryWithinCap(doc.entries.length) // a merge does not add a row
      const addition: EntryAddition = {
        id: randomTempId(),
        food_plan_id: doc.plan.id,
        day_meal_id: v.target.kind === 'cell' ? v.target.dayMealId : null,
        is_extra: v.target.kind === 'extra',
        food_item_id: v.food.id,
        basis: v.result.basis,
        amount: v.result.amount,
        sort_order: prior?.sort_order ?? nextEntrySort(v.target),
      }
      return upsertFoodPlanEntry(userId, addition, v.result.preserveBasis, null)
    },
    meta: { errorToast: "Couldn't add the food. Please try again." },
    onSuccess: invalidate,
    onSettled: () => { setPickedFood(null); setAddTarget(null) },
  })

  const editMut = useMutation({
    mutationFn: (v: { id: string; basis: EntryBasis; amount: number }) =>
      updateFoodPlanEntry(v.id, { basis: v.basis, amount: v.amount }),
    meta: { errorToast: "Couldn't update the food. Please try again." },
    onSuccess: invalidate,
    onSettled: () => setEditEntryId(null),
  })

  const removeMut = useMutation({
    mutationFn: (id: string) => deleteFoodPlanEntry(id),
    meta: { errorToast: "Couldn't remove the food. Please try again." },
    onSuccess: invalidate,
  })

  const addTargetExisting = addTarget && pickedFood ? existingEntry(pickedFood, addTarget) : undefined
  const editingEntry = doc.entries.find((e) => e.id === editEntryId) ?? null
  const editingFood = editingEntry ? foodById.get(editingEntry.food_item_id) : undefined

  return (
    <div className="mt-4">
      <h1 className="text-lg font-semibold text-gray-900">Food plan</h1>
      <div className="mt-4 space-y-4">
        {view.days.map((dayView, i) => (
          <FoodPlanDayCard
            key={dayView.day.id}
            dayView={dayView}
            dayIndex={i}
            foodById={foodById}
            onAddFoodToCell={(dayMealId) => setAddTarget({ kind: 'cell', dayMealId })}
            onEditEntry={(entryId) => setEditEntryId(entryId)}
            onRemoveEntry={(entryId) => removeMut.mutate(entryId)}
          />
        ))}
      </div>
      <FoodPlanExtras
        extras={view.extras}
        foodById={foodById}
        onAddFood={() => setAddTarget({ kind: 'extra' })}
        onEditEntry={(entryId) => setEditEntryId(entryId)}
        onRemoveEntry={(entryId) => removeMut.mutate(entryId)}
      />

      {addTarget && !pickedFood ? (
        <FoodPicker foods={foodsQuery.data ?? []} onPick={(f) => setPickedFood(f)} onClose={() => setAddTarget(null)} />
      ) : null}
      {addTarget && pickedFood ? (
        <EntryAmountDialog
          food={pickedFood}
          existing={addTargetExisting}
          saving={addMut.isPending}
          onSave={(r) => addMut.mutate({ food: pickedFood, target: addTarget, result: r })}
          onClose={() => { setPickedFood(null); setAddTarget(null) }}
        />
      ) : null}
      {editingEntry && editingFood ? (
        <EntryAmountDialog
          food={editingFood}
          initial={{ basis: editingEntry.basis, amount: editingEntry.amount }}
          saving={editMut.isPending}
          onSave={(r) => editMut.mutate({ id: editingEntry.id, basis: r.basis, amount: r.amount })}
          onClose={() => setEditEntryId(null)}
        />
      ) : null}
    </div>
  )
}
