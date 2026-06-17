import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import type { FoodItem, FoodPlanDailyTarget, MealTarget, MealTargetMetric } from '../lib/types'
import type { DayView } from '../lib/food/view'
import {
  nutrientTotals, totalWeight, calorieDensityPerGram,
  type NutrientKey, type NutrientTotal,
} from '../lib/food/nutrition'
import {
  dailyMetricForNutrientKey,
  resolveDailyTargets,
  resolveMealTargets,
} from '../lib/food/targets'
import { useWeightUnit } from '../lib/use-weight-unit'
import { formatCalorieDensity, formatDailyTargetBand } from './nutrition-format'
import NutrientTotalCell, { WeightCell, type NutrientCellKind } from './NutrientTotalCell'
import TargetStatusMark from './TargetStatusMark'
import { FLAT_TABLE_HEADER, POPOVER_SURFACE } from '../components/flat-table-styles'

const REVIEW_COLS: { key: NutrientKey; label: string; kind: NutrientCellKind }[] = [
  { key: 'calories', label: 'Calories', kind: 'calories' },
  { key: 'carbs_grams', label: 'Carbs', kind: 'grams' },
  { key: 'protein_grams', label: 'Protein', kind: 'grams' },
  { key: 'fat_grams', label: 'Fat', kind: 'grams' },
  { key: 'fiber_grams', label: 'Fiber', kind: 'grams' },
  { key: 'sugar_grams', label: 'Sugar', kind: 'grams' },
  { key: 'sodium_mg', label: 'Sodium', kind: 'mg' },
]

const MEAL_TARGET_PRIORITY: MealTargetMetric[] = [
  'calories',
  'protein',
  'fat_pct',
  'sugar_pct',
  'carb_protein_ratio',
]

export default function DayNutritionReview({
  dayView,
  dayIndex,
  foodById,
  dailyTargets,
  mealTargets,
  onClose,
}: {
  dayView: DayView
  dayIndex: number
  foodById: Map<string, FoodItem>
  dailyTargets: FoodPlanDailyTarget[]
  mealTargets: MealTarget[]
  onClose: () => void
}) {
  const { weightUnit } = useWeightUnit()
  const entries = dayView.cells.flatMap((cell) => cell.entries)
  const totals = nutrientTotals(entries, foodById)
  const weight = totalWeight(entries, foodById)
  const density = calorieDensityPerGram(totals.calories, weight)
  const resolvedDaily = resolveDailyTargets(dailyTargets, totals, density, dayView.dayType)
  const activeDailyTargets = dailyTargets.filter((target) => target.mode !== 'off')
  const densityTarget = activeDailyTargets.find((target) => target.metric === 'calorie_density')
  const nameForId = (id: string) => foodById.get(id)?.name ?? 'Unknown food'
  const partial = dayView.dayType === 'partial'

  return (
    <aside className={`sticky top-3 self-start overflow-hidden ${POPOVER_SURFACE}`}>
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-900">Day {dayIndex + 1} nutrition review</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close nutrition review"
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X size={15} />
        </button>
      </div>
      <div className="max-h-[calc(76vh-5rem)] overflow-auto p-3">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          <span>{entries.length} foods</span>
          <span><span className="text-gray-400">Weight </span><WeightCell weight={weight} weightUnit={weightUnit} nameForId={nameForId} /></span>
          <span><span className="text-gray-400">Density </span>{formatCalorieDensity(density, weightUnit)}</span>
        </div>

        {partial ? (
          <div className="mb-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
            <strong className="font-medium text-gray-800">Partial day.</strong>{' '}
            Daily targets are shown as neutral reference. Meal targets are still checked.
          </div>
        ) : null}

        <section className="mb-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {partial ? 'Day totals - full-day targets for reference' : 'Day vs daily targets'}
          </h3>
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className={FLAT_TABLE_HEADER}>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Metric</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Weight</th>
                  {REVIEW_COLS.map((col) => (
                    <th key={col.key} scope="col" className="px-2 py-1.5 text-right font-medium">{col.label}</th>
                  ))}
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Density</th>
                </tr>
              </thead>
              <tbody>
                {activeDailyTargets.length > 0 ? (
                  <tr aria-label="Daily target" className="border-t border-gray-200 text-xs text-gray-500">
                    <th scope="row" className="px-2 py-1.5 text-left font-medium">Daily target</th>
                    <td className="px-2 py-1.5" />
                    {REVIEW_COLS.map((col) => {
                      const metric = dailyMetricForNutrientKey(col.key)
                      const target = metric ? activeDailyTargets.find((candidate) => candidate.metric === metric) : undefined
                      return (
                        <td key={col.key} className="px-2 py-1.5 text-right tabular-nums">
                          {target ? formatDailyTargetBand(target.metric, target.mode, target.target_min, target.target_max, weightUnit) : ''}
                        </td>
                      )
                    })}
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {densityTarget
                        ? formatDailyTargetBand('calorie_density', densityTarget.mode, densityTarget.target_min, densityTarget.target_max, weightUnit)
                        : ''}
                    </td>
                  </tr>
                ) : null}
                <tr aria-label="Day total" className="border-t border-gray-100">
                  <th scope="row" className="px-2 py-1.5 text-left font-medium">Day total</th>
                  <td className="px-2 py-1.5 text-right"><WeightCell weight={weight} weightUnit={weightUnit} nameForId={nameForId} /></td>
                  {REVIEW_COLS.map((col) => {
                    const metric = dailyMetricForNutrientKey(col.key)
                    const target = metric ? resolvedDaily.get(metric) : undefined
                    return (
                      <td key={col.key} className="px-2 py-1.5 text-right">
                        <NutrientTotalCell total={totals[col.key]} kind={col.kind} nameForId={nameForId} />
                        {target ? <TargetStatusMark status={target.status} /> : null}
                      </td>
                    )
                  })}
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatCalorieDensity(density, weightUnit)}
                    {resolvedDaily.get('calorie_density') ? <TargetStatusMark status={resolvedDaily.get('calorie_density')!.status} /> : null}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Meal targets{partial ? <span className="font-normal normal-case tracking-normal text-gray-400"> - still checked</span> : null}
          </h3>
          <p className="mb-2 text-xs text-gray-400">An incomplete Meal is never compared with a target.</p>
          <div className="overflow-hidden rounded border border-gray-200">
            {dayView.cells.map((cell, index) => (
              <MealReviewRow
                key={cell.dayMealId}
                cell={cell}
                foodById={foodById}
                nameForId={nameForId}
                mealTargets={mealTargets.filter((target) => target.meal_id === cell.meal.id)}
                last={index === dayView.cells.length - 1}
              />
            ))}
          </div>
        </section>
      </div>
      <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-400">
        Review stays open while you edit and scroll.
      </div>
    </aside>
  )
}

function MealReviewRow({
  cell,
  foodById,
  nameForId,
  mealTargets,
  last,
}: {
  cell: DayView['cells'][number]
  foodById: Map<string, FoodItem>
  nameForId: (id: string) => string
  mealTargets: MealTarget[]
  last: boolean
}) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const totals = nutrientTotals(cell.entries, foodById)
  const resolved = resolveMealTargets(mealTargets, totals)
  const primary = MEAL_TARGET_PRIORITY.map((metric) => resolved.get(metric)).find((target) => target !== undefined)

  return (
    <div className={last ? '' : 'border-b border-gray-100'}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        {open ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
        <span className="font-medium text-gray-800">{cell.meal.name}</span>
        <span className="ml-auto text-xs text-gray-500">
          {primary ? (
            <>
              {formatMealTargetLabel(primary.metric, totals)}
              <TargetStatusMark status={primary.status} />
            </>
          ) : 'no target'}
        </span>
      </button>
      {open ? (
        <div id={bodyId} className="flex flex-wrap gap-x-4 gap-y-1 px-8 pb-3 text-xs text-gray-500">
          <BreakdownStat label="Cal">
            <NutrientTotalCell total={totals.calories} kind="calories" nameForId={nameForId} />
          </BreakdownStat>
          <BreakdownStat label="Protein">
            <NutrientTotalCell total={totals.protein_grams} kind="grams" nameForId={nameForId} />
          </BreakdownStat>
          <BreakdownStat label="Carbs">
            <NutrientTotalCell total={totals.carbs_grams} kind="grams" nameForId={nameForId} />
          </BreakdownStat>
          <BreakdownStat label="Fat">
            <NutrientTotalCell total={totals.fat_grams} kind="grams" nameForId={nameForId} />
          </BreakdownStat>
          <BreakdownStat label="Sodium">
            <NutrientTotalCell total={totals.sodium_mg} kind="mg" nameForId={nameForId} />
          </BreakdownStat>
        </div>
      ) : null}
    </div>
  )
}

function BreakdownStat({ label, children }: { label: string; children: ReactNode }) {
  return <span><span className="text-gray-400">{label} </span>{children}</span>
}

function formatMealTargetLabel(metric: MealTargetMetric, totals: Record<NutrientKey, NutrientTotal>): string {
  if (metric === 'calories') return totals.calories.state === 'complete' ? `${Math.round(totals.calories.value)} kcal` : 'Calories'
  if (metric === 'protein') return totals.protein_grams.state === 'complete' ? `${Math.round(totals.protein_grams.value)} g protein` : 'Protein'
  if (metric === 'fat_pct') return 'Fat%'
  if (metric === 'sugar_pct') return 'Sugar%'
  return 'Carb:Pro'
}
