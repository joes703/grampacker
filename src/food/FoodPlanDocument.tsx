import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, MouseSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, horizontalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import {
  queryKeys, fetchFoodItems, fetchFoodPlan,
  upsertFoodPlanEntry, upsertFoodPlanEntries, updateFoodPlanEntry, deleteFoodPlanEntry,
  assertFoodPlanEntryWithinCap, type EntryAddition,
  addFoodPlanDay, deleteFoodPlanDay, updateDayType, assertFoodPlanDayWithinCap, duplicateFoodPlanDay,
  addMealDefinition, deleteMeal, deleteDayMeal, addDayMeal, assertMealDefinitionWithinCap,
  saveFoodPlanTargets, type TargetsSavePayload,
  invalidateFoodPlanCaches,
} from '../lib/queries'
import { randomTempId } from '../lib/random-temp-id'
import type { EntryBasis, FoodItem, FoodPlanEntry, Meal, FoodPlanDocument as Doc } from '../lib/types'
import { useFoodPlanView } from './useFoodPlanDocument'
import { useFoodReorder } from './useFoodReorder'
import FoodPlanDaySection from './FoodPlanDaySection'
import FoodPlanExtras from './FoodPlanExtras'
import FoodPicker from './FoodPicker'
import EntryAmountDialog, { type EntryAmountAlsoDay, type EntryAmountResult } from './EntryAmountDialog'
import AddMealDialog from './AddMealDialog'
import MoveCopyEntryDialog, { type MoveCopyTarget } from './MoveCopyEntryDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import ScheduleGridDialog, { type ScheduleToggle } from './ScheduleGridDialog'
import FoodPlanSummary from './FoodPlanSummary'
import FoodPlanSkeleton from './FoodPlanSkeleton'
import TargetsDialog from './TargetsDialog'
import DayNutritionReview from './DayNutritionReview'
import { FLAT_TABLE_SURFACE } from '../components/flat-table-styles'

type AddTarget = { kind: 'cell'; dayMealId: string } | { kind: 'extra' }

export default function FoodPlanDocument({ listId, userId, doc }: { listId: string; userId: string; doc: Doc }) {
  // Colocate the food-plan subscription here: the day/meal reorder DndContexts
  // below mutate the ['food-plan', listId] cache, so per the colocation rule
  // (project_reorder_subscription_colocation, commit b8624ec) the component
  // hosting those contexts must also subscribe and derive its view from the
  // subscribed data rather than from the prop.
  const planQuery = useQuery({
    queryKey: queryKeys.foodPlan(listId),
    queryFn: () => fetchFoodPlan(userId, listId),
  })
  const currentDoc = planQuery.data ?? doc
  const view = useFoodPlanView(currentDoc)
  const foodsQuery = useQuery({ queryKey: queryKeys.foodItems(), queryFn: () => fetchFoodItems(userId) })
  // Keystone memo (mirrors useFoodProjection.ts:59): a stable foodById identity
  // is what lets every downstream child's own useMemo skip recompute when an
  // unrelated dialog/edit state flips here. Without this, the fresh Map busts
  // them all on every render.
  const foodById = useMemo(
    () => new Map<string, FoodItem>((foodsQuery.data ?? []).map((f) => [f.id, f])),
    [foodsQuery.data],
  )

  const qc = useQueryClient()
  const invalidate = () => invalidateFoodPlanCaches(qc, listId)

  const reorderDays = useFoodReorder(listId, 'days')
  const reorderMeals = useFoodReorder(listId, 'meals')

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDayDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = view.days.map((d) => d.day.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    if (moved === undefined) return
    next.splice(to, 0, moved)
    reorderDays.mutate(next)
  }

  function handleMealDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = view.meals.map((m) => m.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    if (moved === undefined) return
    next.splice(to, 0, moved)
    reorderMeals.mutate(next)
  }

  const [addTarget, setAddTarget] = useState<AddTarget | null>(null)
  const [pickedFood, setPickedFood] = useState<FoodItem | null>(null)
  const [editEntryId, setEditEntryId] = useState<string | null>(null)
  const [confirmDeleteDayId, setConfirmDeleteDayId] = useState<string | null>(null)
  const [showAddMeal, setShowAddMeal] = useState(false)
  const [confirmDeleteMealId, setConfirmDeleteMealId] = useState<string | null>(null)
  const [moveCopy, setMoveCopy] = useState<{ mode: 'move' | 'copy'; entry: FoodPlanEntry } | null>(null)
  const [showGrid, setShowGrid] = useState(false)
  const [showTargets, setShowTargets] = useState(false)
  const [reviewDayId, setReviewDayId] = useState<string | null>(null)

  function openMoveCopy(mode: 'move' | 'copy', entryId: string) {
    const entry = currentDoc.entries.find((e) => e.id === entryId)
    if (entry) setMoveCopy({ mode, entry })
  }

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

  // Stable so FoodPicker's `foods.filter((f) => usedFoodIds.has(f.id))` memo
  // (FoodPicker.tsx:69) actually holds across this component's re-renders.
  const usedFoodIds = useMemo(
    () => new Set(currentDoc.entries.map((e) => e.food_item_id)),
    [currentDoc.entries],
  )

  function computeAlsoDays(target: AddTarget): EntryAmountAlsoDay[] {
    if (target.kind !== 'cell') return []
    let mealId: string | undefined
    view.days.forEach((dv) => dv.cells.forEach((c) => { if (c.dayMealId === target.dayMealId) mealId = c.meal.id }))
    if (mealId === undefined) return []
    const out: EntryAmountAlsoDay[] = []
    view.days.forEach((dv, i) => {
      const label = `Day ${i + 1}`
      const cell = dv.cells.find((c) => c.meal.id === mealId)
      if (cell) {
        if (cell.dayMealId !== target.dayMealId) out.push({ id: cell.dayMealId, dayMealId: cell.dayMealId, label })
      } else {
        out.push({ id: `${dv.day.id}:${mealId}`, dayMealId: null, label, omitted: true })
      }
    })
    return out
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
    onSuccess: () => {
      setPickedFood(null)
      setAddTarget(null)
      return invalidate()
    },
  })

  const editMut = useMutation({
    mutationFn: (v: { id: string; basis: EntryBasis; amount: number }) =>
      updateFoodPlanEntry(v.id, { basis: v.basis, amount: v.amount }),
    meta: { errorToast: "Couldn't update the food. Please try again." },
    onSuccess: () => {
      setEditEntryId(null)
      return invalidate()
    },
  })

  const removeMut = useMutation({
    mutationFn: (id: string) => deleteFoodPlanEntry(id),
    meta: { errorToast: "Couldn't remove the food. Please try again." },
    onSuccess: invalidate,
  })

  const saveTargetsMut = useMutation({
    mutationFn: (p: TargetsSavePayload) => saveFoodPlanTargets(userId, currentDoc.plan.id, p),
    meta: { errorToast: "Couldn't save targets. Please try again." },
    onSuccess: () => {
      setShowTargets(false)
      return invalidate()
    },
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
    onSuccess: () => { setMoveCopy(null); return invalidate() },
  })

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
      assertFoodPlanDayWithinCap(currentDoc.days.length)
      const sourceEntryCount = view.days
        .find((day) => day.day.id === dayId)
        ?.cells.reduce((total, cell) => total + cell.entries.length, 0) ?? 0
      if (sourceEntryCount > 0) {
        assertFoodPlanEntryWithinCap(currentDoc.entries.length + sourceEntryCount - 1)
      }
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

  const addMealMut = useMutation({
    mutationFn: (name: string) => {
      assertMealDefinitionWithinCap(currentDoc.meals.length)
      const sortOrder = currentDoc.meals.reduce((m, x) => Math.max(m, x.sort_order + 1), 0)
      return addMealDefinition(userId, currentDoc.plan.id, name, sortOrder)
    },
    meta: { errorToast: "Couldn't add the meal. Please try again." },
    onSuccess: () => {
      setShowAddMeal(false)
      return invalidate()
    },
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

  const addTargetExisting = addTarget && pickedFood ? existingEntry(pickedFood, addTarget) : undefined
  const editingEntry = currentDoc.entries.find((e) => e.id === editEntryId) ?? null
  const editingFood = editingEntry ? foodById.get(editingEntry.food_item_id) : undefined
  const reviewDayIndex = reviewDayId === null ? -1 : view.days.findIndex((day) => day.day.id === reviewDayId)
  const reviewDayView = reviewDayIndex >= 0 ? view.days[reviewDayIndex] : null
  const fullDayCount = view.days.filter((day) => day.dayType === 'full').length
  const plannedMealCount = view.days.reduce((total, day) => total + day.cells.length, 0)
  const perMealCounts = useMemo(
    () => view.meals.map((meal) => ({
      meal,
      count: view.days.reduce((total, day) => total + (day.scheduledMealIds.has(meal.id) ? 1 : 0), 0),
    })),
    [view],
  )

  if (foodsQuery.isLoading) {
    return <FoodPlanSkeleton />
  }
  if (foodsQuery.isError) {
    return (
      <div className="mt-6">
        <p className="text-sm text-gray-700">Couldn't load your food library.</p>
        <button
          type="button"
          onClick={() => foodsQuery.refetch()}
          className="mt-2 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold text-gray-900">Food plan</h1>
        <button
          type="button"
          onClick={() => setShowGrid(true)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Edit schedule
        </button>
        <button
          type="button"
          onClick={() => addDayMut.mutate()}
          disabled={addDayMut.isPending}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          Add day
        </button>
        <button
          type="button"
          onClick={() => setShowAddMeal(true)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Add meal
        </button>
        <button
          type="button"
          onClick={() => setShowTargets(true)}
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
        >
          Targets
        </button>
      </div>
      <div className="mb-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-gray-800">
            {view.days.length} days - {plannedMealCount} planned meals - {fullDayCount} full days
          </span>
          {perMealCounts.length > 0 ? (
            <span className="text-xs text-gray-500">
              {perMealCounts.map(({ meal, count }) => `${meal.name} x${count}`).join(', ')}
            </span>
          ) : null}
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleMealDragEnd}>
          <SortableContext items={view.meals.map((m) => m.id)} strategy={horizontalListSortingStrategy}>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Meal order:</span>
              {view.meals.map((m) => (
                <SortableMealChip key={m.id} meal={m} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
      <FoodPlanSummary view={view} foodById={foodById} dailyTargets={currentDoc.dailyTargets} />
      <div className={reviewDayView ? 'mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]' : 'mt-4'}>
        <div>
          <div data-testid="food-plan-document" className={FLAT_TABLE_SURFACE}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDayDragEnd}>
              <SortableContext items={view.days.map((d) => d.day.id)} strategy={verticalListSortingStrategy}>
                <div>
                  {view.days.map((dayView, i) => (
                    <SortableDaySection
                      key={dayView.day.id}
                      embedded
                      dayView={dayView}
                      dayIndex={i}
                      listId={listId}
                      userId={userId}
                      foodById={foodById}
                      mealTargets={currentDoc.mealTargets}
                      onAddFoodToCell={(dayMealId) => setAddTarget({ kind: 'cell', dayMealId })}
                      onEditEntry={(entryId) => setEditEntryId(entryId)}
                      onMoveEntry={(entryId) => openMoveCopy('move', entryId)}
                      onCopyEntry={(entryId) => openMoveCopy('copy', entryId)}
                      onRemoveEntry={(entryId) => removeMut.mutate(entryId)}
                      onSetDayType={(override) => dayTypeMut.mutate({ dayId: dayView.day.id, override })}
                      onDeleteDay={() => setConfirmDeleteDayId(dayView.day.id)}
                      onDuplicate={() => duplicateDayMut.mutate(dayView.day.id)}
                      onReviewNutrition={() => setReviewDayId(dayView.day.id)}
                      allMeals={view.meals}
                      onOmitMeal={(dayMealId) => omitMealMut.mutate(dayMealId)}
                      onDeleteMeal={(mealId) => setConfirmDeleteMealId(mealId)}
                      onRestoreMeal={(dayId, mealId) => restoreMealMut.mutate({ dayId, mealId })}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <FoodPlanExtras
              embedded
              extras={view.extras}
              foodById={foodById}
              onAddFood={() => setAddTarget({ kind: 'extra' })}
              onEditEntry={(entryId) => setEditEntryId(entryId)}
              onMoveEntry={(entryId) => openMoveCopy('move', entryId)}
              onCopyEntry={(entryId) => openMoveCopy('copy', entryId)}
              onRemoveEntry={(entryId) => removeMut.mutate(entryId)}
            />
          </div>
        </div>
        {reviewDayView ? (
          <DayNutritionReview
            dayView={reviewDayView}
            dayIndex={reviewDayIndex}
            foodById={foodById}
            dailyTargets={currentDoc.dailyTargets}
            mealTargets={currentDoc.mealTargets}
            onClose={() => setReviewDayId(null)}
          />
        ) : null}
      </div>

      {addTarget && !pickedFood ? (
        <FoodPicker
          foods={foodsQuery.data ?? []}
          usedFoodIds={usedFoodIds}
          userId={userId}
          onPick={(f) => setPickedFood(f)}
          onClose={() => setAddTarget(null)}
        />
      ) : null}
      {addTarget && pickedFood ? (
        <EntryAmountDialog
          food={pickedFood}
          existing={addTargetExisting}
          alsoDays={addTarget.kind === 'cell' ? computeAlsoDays(addTarget) : undefined}
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
      {confirmDeleteDayId ? (
        <ConfirmDialog
          title="Delete day"
          message="Delete this day? Its scheduled meals and the food planned in them will be removed. This cannot be undone."
          confirmLabel="Delete"
          dangerous
          onCancel={() => setConfirmDeleteDayId(null)}
          onConfirm={() => deleteDayMut.mutate(confirmDeleteDayId, { onSuccess: () => setConfirmDeleteDayId(null) })}
        />
      ) : null}
      {showAddMeal ? (
        <AddMealDialog saving={addMealMut.isPending} onSave={(name) => addMealMut.mutate(name)} onClose={() => setShowAddMeal(false)} />
      ) : null}
      {confirmDeleteMealId ? (
        <ConfirmDialog
          title="Delete meal"
          message="Delete this meal from every day in the plan? The food planned in it will be removed. This cannot be undone."
          confirmLabel="Delete"
          dangerous
          onCancel={() => setConfirmDeleteMealId(null)}
          onConfirm={() => deleteMealMut.mutate(confirmDeleteMealId, { onSuccess: () => setConfirmDeleteMealId(null) })}
        />
      ) : null}
      {moveCopy && foodById.get(moveCopy.entry.food_item_id) ? (
        <MoveCopyEntryDialog
          mode={moveCopy.mode}
          entry={moveCopy.entry}
          food={foodById.get(moveCopy.entry.food_item_id)!}
          view={view}
          onConfirm={(r) => moveCopyMut.mutate({ entry: moveCopy.entry, target: r.target, preserveBasis: r.preserveBasis, isMove: moveCopy.mode === 'move' })}
          onClose={() => setMoveCopy(null)}
        />
      ) : null}
      {showGrid ? (
        <ScheduleGridDialog view={view} onToggle={(t) => toggleCellMut.mutate(t)} onClose={() => setShowGrid(false)} />
      ) : null}
      {showTargets ? (
        <TargetsDialog
          plan={currentDoc.plan}
          meals={currentDoc.meals}
          dailyTargets={currentDoc.dailyTargets}
          mealTargets={currentDoc.mealTargets}
          saving={saveTargetsMut.isPending}
          onSave={(p) => saveTargetsMut.mutate(p)}
          onClose={() => setShowTargets(false)}
        />
      ) : null}
    </div>
  )
}

// Sortable wrapper for a day section. Calls useSortable, builds the grip handle,
// and forwards the outer ref + transform style + handle to the presentational
// FoodPlanDaySection. Must be rendered inside the day SortableContext. Accepts the
// same props as FoodPlanDaySection and spreads them through.
function SortableDaySection(props: React.ComponentProps<typeof FoodPlanDaySection>) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: props.dayView.day.id })

  const outerStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const handle = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder day"
      className="inline-flex h-7 w-5 shrink-0 cursor-grab items-center justify-center text-gray-300 hover:text-gray-500 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <GripVertical size={14} />
    </button>
  )

  return (
    <FoodPlanDaySection {...props} dragHandle={handle} outerRef={setNodeRef} outerStyle={outerStyle} />
  )
}

// Sortable chip for the meal legend. Calls useSortable, renders a pill with a
// grip handle and the meal name. Must be rendered inside the meal SortableContext.
function SortableMealChip({ meal }: { meal: Meal }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: meal.id })

  return (
    <span
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2 py-1 text-xs text-gray-700"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder meal"
        className="inline-flex cursor-grab items-center text-gray-300 hover:text-gray-500 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <GripVertical size={12} />
      </button>
      {meal.name}
    </span>
  )
}
