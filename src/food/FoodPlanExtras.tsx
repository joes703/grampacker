import type { FoodItem, FoodPlanEntry } from '../lib/types'
import { FLAT_TABLE_SURFACE, FLAT_TABLE_HEADER } from '../components/flat-table-styles'
import FoodPlanEntryRow from './FoodPlanEntryRow'

export default function FoodPlanExtras({
  extras, foodById, onAddFood, onEditEntry, onRemoveEntry,
}: {
  extras: FoodPlanEntry[]
  foodById: Map<string, FoodItem>
  onAddFood?: () => void
  onEditEntry?: (entryId: string) => void
  onRemoveEntry?: (entryId: string) => void
}) {
  return (
    <div className={`${FLAT_TABLE_SURFACE} mt-4`}>
      <div className={FLAT_TABLE_HEADER}>Extras</div>
      {extras.length === 0 ? (
        <p className="px-3 py-2 text-sm text-gray-400">Nothing in extras.</p>
      ) : (
        extras.map((entry) => (
          <FoodPlanEntryRow
            key={entry.id}
            entry={entry}
            food={foodById.get(entry.food_item_id)}
            onEdit={onEditEntry ? () => onEditEntry(entry.id) : undefined}
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
