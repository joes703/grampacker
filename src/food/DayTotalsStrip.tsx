import { useWeightUnit } from '../lib/use-weight-unit'
import { nutrientTotal, totalWeight } from '../lib/food/nutrition'
import NutrientTotalCell, { WeightCell } from './NutrientTotalCell'
import type { FoodItem } from '../lib/types'
import type { DayView } from '../lib/food/view'

// Deliberately compact (matches the approved prototype): calories + weight only,
// rendered INLINE inside the existing day header (no padded strip of its own).
// Macros and density live in the all-days summary and the 3B review panel.
export default function DayTotalsStrip({
  dayView, foodById,
}: {
  dayView: DayView
  foodById: Map<string, FoodItem>
}) {
  const { weightUnit } = useWeightUnit()
  const entries = dayView.cells.flatMap((c) => c.entries)
  const nameForId = (id: string) => foodById.get(id)?.name ?? 'Unknown food'
  return (
    <span className="flex items-center gap-3 text-xs text-gray-500">
      <span className="flex items-center gap-1"><span className="text-gray-400">Cal</span>
        <NutrientTotalCell total={nutrientTotal(entries, foodById, 'calories')} kind="calories" nameForId={nameForId} /></span>
      <span className="flex items-center gap-1"><span className="text-gray-400">Weight</span>
        <WeightCell weight={totalWeight(entries, foodById)} weightUnit={weightUnit} nameForId={nameForId} /></span>
    </span>
  )
}
