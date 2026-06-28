import { memo, useMemo } from 'react'
import { useWeightUnit } from '../lib/use-weight-unit'
import { MISSING_FOOD_LABEL, nutrientTotal, totalWeight } from '../lib/food/nutrition'
import NutrientTotalCell, { WeightCell } from './NutrientTotalCell'
import type { FoodItem } from '../lib/types'
import type { DayView } from '../lib/food/view'

// Deliberately compact (matches the approved prototype): calories + weight only,
// rendered INLINE inside the existing day header (no padded strip of its own).
// Macros and density live in the all-days summary and the 3B review panel.
//
// React.memo is effective here (unlike the rest of src/food): both props are
// referentially stable - `foodById` is memoized in FoodPlanDocument and
// `dayView` comes from the memoized view - and there are no inline callbacks to
// bust the barrier. So a parent dialog/edit re-render skips this leaf entirely.
function DayTotalsStrip({
  dayView, foodById,
}: {
  dayView: DayView
  foodById: Map<string, FoodItem>
}) {
  const { weightUnit } = useWeightUnit()
  const { calories, weight } = useMemo(() => {
    const entries = dayView.cells.flatMap((c) => c.entries)
    return {
      calories: nutrientTotal(entries, foodById, 'calories'),
      weight: totalWeight(entries, foodById),
    }
  }, [dayView, foodById])
  const nameForId = (id: string) => foodById.get(id)?.name ?? MISSING_FOOD_LABEL
  return (
    <span className="flex items-center gap-3 text-xs text-gray-500">
      {/* Calories carry their own unit (kcal), so no redundant "Cal" label -
          standardized on kcal across the compact strips. Weight keeps a label
          because "100 g" alone does not say what it measures. */}
      <span className="flex items-center gap-1">
        <NutrientTotalCell total={calories} kind="calories" nameForId={nameForId} /></span>
      <span className="flex items-center gap-1"><span className="text-gray-400">Weight</span>
        <WeightCell weight={weight} weightUnit={weightUnit} nameForId={nameForId} /></span>
    </span>
  )
}

export default memo(DayTotalsStrip)
