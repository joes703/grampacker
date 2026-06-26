import { PackagePlus, Plus } from 'lucide-react'
import type { FoodItem, FoodPlanEntry } from '../lib/types'
import { FLAT_TABLE_SURFACE, FLAT_TABLE_HEADER } from '../components/flat-table-styles'
import { useWeightUnit } from '../lib/use-weight-unit'
import { totalWeight } from '../lib/food/nutrition'
import { WeightCell } from './NutrientTotalCell'
import FoodPlanEntryRow from './FoodPlanEntryRow'

export default function FoodPlanExtras({
  extras, foodById, onAddFood, onEditEntry, onEditFood, onMoveEntry, onCopyEntry, onRemoveEntry, embedded = false,
}: {
  extras: FoodPlanEntry[]
  foodById: Map<string, FoodItem>
  onAddFood?: () => void
  onEditEntry?: (entryId: string) => void
  onEditFood?: (foodItemId: string) => void
  onMoveEntry?: (entryId: string) => void
  onCopyEntry?: (entryId: string) => void
  onRemoveEntry?: (entryId: string) => void
  embedded?: boolean
}) {
  const { weightUnit } = useWeightUnit()
  const nameForId = (id: string) => foodById.get(id)?.name ?? 'Unknown food'

  return (
    <div
      id="food-extras"
      data-testid="food-extras"
      className={embedded ? 'border-t-2 border-gray-200 bg-white' : `${FLAT_TABLE_SURFACE} mt-4`}
    >
      {/* Strong-divider section header (design Approach D): the package-plus
          icon + "Extras" + descriptor on the left; total packed weight and the
          add-food control on the right. */}
      <div className={`${FLAT_TABLE_HEADER} gap-2 px-3`}>
        <PackagePlus size={14} className="shrink-0 text-gray-500" aria-hidden="true" />
        <span className="text-sm font-semibold text-gray-900">Extras</span>
        <span className="hidden text-xs font-normal text-gray-500 sm:inline">
          Extra or emergency food - counted in packed food, not assigned to a day.
        </span>
        <span className="ml-auto flex items-center gap-2">
          {extras.length > 0 ? (
            <WeightCell weight={totalWeight(extras, foodById)} weightUnit={weightUnit} nameForId={nameForId} />
          ) : null}
          {onAddFood ? (
            <button
              type="button"
              onClick={onAddFood}
              aria-label="Add food"
              className="inline-flex h-7 items-center gap-1 rounded border border-gray-300 bg-white px-2 text-xs font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-700"
            >
              <Plus size={13} aria-hidden="true" />
              <span className="hidden sm:inline">Add</span>
            </button>
          ) : null}
        </span>
      </div>
      {extras.length === 0 ? (
        <p className="px-3 py-2 text-sm text-gray-400">
          No extra food yet. Use Extras for spare meals, emergency bars, or food that is packed but not assigned to a specific day.
        </p>
      ) : (
        extras.map((entry) => (
          <FoodPlanEntryRow
            key={entry.id}
            entry={entry}
            food={foodById.get(entry.food_item_id)}
            onEdit={onEditEntry ? () => onEditEntry(entry.id) : undefined}
            onEditFood={onEditFood ? () => onEditFood(entry.food_item_id) : undefined}
            onMove={onMoveEntry ? () => onMoveEntry(entry.id) : undefined}
            onCopy={onCopyEntry ? () => onCopyEntry(entry.id) : undefined}
            onRemove={onRemoveEntry ? () => onRemoveEntry(entry.id) : undefined}
          />
        ))
      )}
    </div>
  )
}
