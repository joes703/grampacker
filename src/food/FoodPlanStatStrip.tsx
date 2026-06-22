import { useWeightUnit } from '../lib/use-weight-unit'
import { formatTotalWeight } from '../lib/weight'
import { formatCalorieDensity } from './nutrition-format'
import type { TripSummary } from '../lib/food/nutrition'
import type { FoodItem } from '../lib/types'
import { WeightCell } from './NutrientTotalCell'
import { FLAT_TABLE_EYEBROW } from '../components/flat-table-styles'

// Headline reconciliation strip: the three numbers the planner glances at most -
// total packed food weight, the average calories of a full day, and how
// calorie-dense the pack is. All three come from the same summarizeTrip pass the
// all-days table uses (lifted to FoodPlanDocument and passed in), so the strip
// and the table can never disagree. Reads the global weight unit so the g/oz
// control in the toolbar updates it live.
export default function FoodPlanStatStrip({
  summary, foodById,
}: {
  summary: TripSummary
  foodById: Map<string, FoodItem>
}) {
  const { weightUnit } = useWeightUnit()
  const nameForId = (id: string) => foodById.get(id)?.name ?? 'Unknown food'
  const { fullDays, totalDays, totals } = summary.fullDayAverage
  const avgCal = totals.calories
  const avgComplete = avgCal.state === 'complete' && fullDays > 0
  const packedWeight = summary.packed.weight

  return (
    <div className="grid grid-cols-3 divide-x divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="px-3 py-2 text-center">
        <p className={FLAT_TABLE_EYEBROW}>Packed food</p>
        <p className="mt-0.5 text-base">
          {packedWeight.state === 'complete'
            ? <span className="font-mono tabular-nums text-gray-900">{formatTotalWeight(Math.round(packedWeight.grams), weightUnit)}</span>
            : <WeightCell weight={packedWeight} weightUnit={weightUnit} nameForId={nameForId} />}
        </p>
      </div>
      <div className="px-3 py-2 text-center">
        <p className={FLAT_TABLE_EYEBROW}>Full-day average</p>
        <p className="mt-0.5 text-base">
          {avgComplete
            ? <span className="font-mono tabular-nums text-gray-900">{Math.round(avgCal.value)}<span className="text-xs text-gray-400"> kcal</span></span>
            : <span className="text-gray-400">-</span>}
        </p>
        <p className="text-[10px] text-gray-400">{fullDays} of {totalDays} days counted</p>
      </div>
      <div className="px-3 py-2 text-center">
        <p className={FLAT_TABLE_EYEBROW}>Calorie density</p>
        <p className="mt-0.5 font-mono text-base tabular-nums text-gray-900">{formatCalorieDensity(summary.packed.calorieDensityPerGram, weightUnit)}</p>
      </div>
    </div>
  )
}
