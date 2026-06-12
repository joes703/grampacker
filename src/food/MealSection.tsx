import type { FoodItem } from '../lib/types'
import type { CellView } from './useFoodPlanDocument'
import { FLAT_TABLE_HEADER } from '../components/flat-table-styles'
import FoodPlanEntryRow from './FoodPlanEntryRow'

export default function MealSection({
  cell, foodById, headerAction, onAddFood, onEditEntry, onRemoveEntry,
}: {
  cell: CellView
  foodById: Map<string, FoodItem>
  headerAction?: React.ReactNode
  onAddFood?: () => void
  onEditEntry?: (entryId: string) => void
  onRemoveEntry?: (entryId: string) => void
}) {
  return (
    <section className="mt-2">
      <div className={`${FLAT_TABLE_HEADER} flex items-center justify-between`}>
        <span>{cell.meal.name}</span>
        {headerAction}
      </div>
      {cell.entries.length === 0 ? (
        <p className="px-3 py-2 text-sm text-gray-400">No food yet.</p>
      ) : (
        cell.entries.map((entry) => (
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
    </section>
  )
}
