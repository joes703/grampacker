import type { FoodItem } from '../lib/types'
import type { DayView } from './useFoodPlanDocument'
import { FLAT_TABLE_SURFACE } from '../components/flat-table-styles'
import MealSection from './MealSection'

export default function FoodPlanDayCard({
  dayView, dayIndex, foodById, headerAction, renderCell, onAddFoodToCell, onEditEntry, onRemoveEntry,
}: {
  dayView: DayView
  dayIndex: number
  foodById: Map<string, FoodItem>
  headerAction?: React.ReactNode
  renderCell?: (dayMealId: string) => React.ReactNode
  onAddFoodToCell?: (dayMealId: string) => void
  onEditEntry?: (entryId: string) => void
  onRemoveEntry?: (entryId: string) => void
}) {
  return (
    <div className={FLAT_TABLE_SURFACE}>
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-900">Day {dayIndex + 1}</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-gray-400">{dayView.dayType}</span>
          {headerAction}
        </div>
      </div>
      {dayView.cells.map((cell) => (
        <MealSection
          key={cell.dayMealId}
          cell={cell}
          foodById={foodById}
          headerAction={renderCell?.(cell.dayMealId)}
          onAddFood={onAddFoodToCell ? () => onAddFoodToCell(cell.dayMealId) : undefined}
          onEditEntry={onEditEntry}
          onRemoveEntry={onRemoveEntry}
        />
      ))}
    </div>
  )
}
