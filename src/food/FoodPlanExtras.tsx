import type { FoodItem, FoodPlanEntry } from '../lib/types'
import { FLAT_TABLE_SURFACE, FLAT_TABLE_HEADER } from '../components/flat-table-styles'
import FoodPlanEntryRow from './FoodPlanEntryRow'

export default function FoodPlanExtras({
  extras, foodById, onAddFood, onEditEntry, onMoveEntry, onCopyEntry, onRemoveEntry, embedded = false,
}: {
  extras: FoodPlanEntry[]
  foodById: Map<string, FoodItem>
  onAddFood?: () => void
  onEditEntry?: (entryId: string) => void
  onMoveEntry?: (entryId: string) => void
  onCopyEntry?: (entryId: string) => void
  onRemoveEntry?: (entryId: string) => void
  embedded?: boolean
}) {
  return (
    <div
      id="food-extras"
      data-testid="food-extras"
      className={embedded ? 'border-t-2 border-gray-200 bg-white' : `${FLAT_TABLE_SURFACE} mt-4`}
    >
      <div className={`${FLAT_TABLE_HEADER} flex-col items-start justify-center gap-0.5 py-2 lg:flex-row lg:items-center lg:justify-start lg:gap-2`}>
        <span>Extras</span>
        <span className="text-xs font-normal text-gray-500">
          Extra or emergency food - counted in packed food, not assigned to a day.
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
            onMove={onMoveEntry ? () => onMoveEntry(entry.id) : undefined}
            onCopy={onCopyEntry ? () => onCopyEntry(entry.id) : undefined}
            onRemove={onRemoveEntry ? () => onRemoveEntry(entry.id) : undefined}
          />
        ))
      )}
      {onAddFood ? (
        <button type="button" onClick={onAddFood} className="px-3 py-2 text-sm font-medium text-emerald-700 hover:underline">
          + Add food
        </button>
      ) : null}
    </div>
  )
}
