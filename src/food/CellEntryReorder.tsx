import { useQuery } from '@tanstack/react-query'
import {
  DndContext, MouseSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { queryKeys, fetchFoodPlan } from '../lib/queries'
import type { FoodItem, FoodPlanEntry } from '../lib/types'
import { useFoodReorder } from './useFoodReorder'
import FoodPlanEntryRow from './FoodPlanEntryRow'

// Reorders the food-plan entries within a single cell (one day_meal) via DnD.
// Per the subscription-colocation rule (project_reorder_subscription_colocation,
// commit b8624ec), this component BOTH subscribes to the ['food-plan', listId]
// cache AND hosts the DndContext that mutates it, deriving the sortable list
// from the subscribed data rather than from props. A DndContext that mutates a
// cache it does not subscribe to triggers a snap-back race against the awaited
// cancelQueries in the reorder mutation's onMutate.
export default function CellEntryReorder({
  listId, userId, dayMealId, foodById, onEditEntry, onRemoveEntry,
}: {
  listId: string
  userId: string
  dayMealId: string
  foodById: Map<string, FoodItem>
  onEditEntry?: (id: string) => void
  onRemoveEntry?: (id: string) => void
}) {
  const planQuery = useQuery({
    queryKey: queryKeys.foodPlan(listId),
    queryFn: () => fetchFoodPlan(userId, listId),
  })
  const reorder = useFoodReorder(listId, 'entries')

  const entries = (planQuery.data?.entries ?? [])
    .filter((e) => e.day_meal_id === dayMealId)
    .sort((a, b) => a.sort_order - b.sort_order)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = entries.map((entry) => entry.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    if (moved === undefined) return
    next.splice(to, 0, moved)
    reorder.mutate(next)
  }

  if (entries.length === 0) {
    return <p className="px-3 py-2 text-sm text-gray-400">No food yet.</p>
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={entries.map((e) => e.id)} strategy={verticalListSortingStrategy}>
        {entries.map((entry) => (
          <SortableEntryRow
            key={entry.id}
            entry={entry}
            food={foodById.get(entry.food_item_id)}
            onEdit={onEditEntry ? () => onEditEntry(entry.id) : undefined}
            onRemove={onRemoveEntry ? () => onRemoveEntry(entry.id) : undefined}
          />
        ))}
      </SortableContext>
    </DndContext>
  )
}

// Sortable wrapper for an entry row. Calls useSortable, builds the grip
// drag-handle, and forwards the outer ref + transform style + handle to the
// presentational FoodPlanEntryRow. Must be rendered inside a SortableContext.
function SortableEntryRow({
  entry, food, onEdit, onRemove,
}: {
  entry: FoodPlanEntry
  food: FoodItem | undefined
  onEdit?: () => void
  onRemove?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: entry.id })

  const outerStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const handle = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      tabIndex={-1}
      aria-label="Drag to reorder"
      className="inline-flex h-7 w-5 shrink-0 cursor-grab items-center justify-center text-gray-300 hover:text-gray-500"
    >
      <GripVertical size={14} />
    </button>
  )

  return (
    <FoodPlanEntryRow
      entry={entry}
      food={food}
      onEdit={onEdit}
      onRemove={onRemove}
      dragHandle={handle}
      outerRef={setNodeRef}
      outerStyle={outerStyle}
    />
  )
}
