import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useWeightUnit } from '../lib/use-weight-unit'
import { type WeightUnit } from '../lib/weight'
import type { FoodItem, FoodPlanDailyTarget, DailyTargetMetric } from '../lib/types'
import type { FoodPlanView } from '../lib/food/view'
import {
  summarizeTrip, type GroupSummary, type NutrientKey, type NutrientTotal,
} from '../lib/food/nutrition'
import { resolveDailyTargets, dailyMetricForNutrientKey, type ResolvedTarget } from '../lib/food/targets'
import { formatCalorieDensity, formatDailyTargetBand } from './nutrition-format'
import TargetStatusMark from './TargetStatusMark'
import { FLAT_TABLE_SURFACE, FLAT_TABLE_HEADER } from '../components/flat-table-styles'
import NutrientTotalCell, { WeightCell, type NutrientCellKind } from './NutrientTotalCell'

type Col = { key: NutrientKey; label: string; kind: NutrientCellKind }
const DEFAULT_COLS: Col[] = [
  { key: 'calories', label: 'Calories', kind: 'calories' },
  { key: 'carbs_grams', label: 'Carbs', kind: 'grams' },
  { key: 'protein_grams', label: 'Protein', kind: 'grams' },
  { key: 'fat_grams', label: 'Fat', kind: 'grams' },
  { key: 'sodium_mg', label: 'Sodium', kind: 'mg' },
]
const OPTIONAL_COLS: Col[] = [
  { key: 'fiber_grams', label: 'Fiber', kind: 'grams' },
  { key: 'sugar_grams', label: 'Sugar', kind: 'grams' },
  { key: 'potassium_mg', label: 'Potassium', kind: 'mg' },
]

// Module-level (not nested in the parent render) so an open IncompleteMarker
// popover inside a cell is not remounted/dismissed on every parent re-render.
// WeightCell is shared from NutrientTotalCell.
function NutCells({ totals, cols, nameForId, targets }: {
  totals: Record<NutrientKey, NutrientTotal>; cols: Col[]; nameForId: (id: string) => string
  targets?: Map<DailyTargetMetric, ResolvedTarget<DailyTargetMetric>>
}) {
  return (
    <>
      {cols.map((c) => {
        const m = dailyMetricForNutrientKey(c.key)
        const rt = m ? targets?.get(m) : undefined
        return (
          <td key={c.key} className="px-2 py-1.5 text-right">
            <NutrientTotalCell total={totals[c.key]} kind={c.kind} nameForId={nameForId} />
            {rt ? <TargetStatusMark status={rt.status} /> : null}
          </td>
        )
      })}
    </>
  )
}

function SummaryRow({ label, group, cols, weightUnit, nameForId }: { label: string; group: GroupSummary; cols: Col[]; weightUnit: WeightUnit; nameForId: (id: string) => string }) {
  return (
    <tr aria-label={label} className="border-t border-gray-200 font-medium">
      <th scope="row" className="px-2 py-1.5 text-left">{label}</th>
      <td className="px-2 py-1.5 text-right"><WeightCell weight={group.weight} weightUnit={weightUnit} nameForId={nameForId} /></td>
      <NutCells totals={group.totals} cols={cols} nameForId={nameForId} />
      <td className="px-2 py-1.5 text-right tabular-nums">{formatCalorieDensity(group.calorieDensityPerGram, weightUnit)}</td>
    </tr>
  )
}

export default function FoodPlanSummary({
  view, foodById, dailyTargets, onEditTargets,
}: {
  view: FoodPlanView
  foodById: Map<string, FoodItem>
  dailyTargets: FoodPlanDailyTarget[]
  onEditTargets?: () => void
}) {
  const { weightUnit } = useWeightUnit()
  const [open, setOpen] = useState(true)
  const [showMore, setShowMore] = useState(false)
  const s = summarizeTrip(view, foodById)
  const dayTargetMaps = s.days.map((d) => resolveDailyTargets(dailyTargets, d.totals, d.calorieDensityPerGram, d.dayType))
  // "Active" = a target the user actually configured. An explicit `off` row must
  // NOT render a Target band or a glyph - filter it before deciding what to show.
  const activeDailyTargets = dailyTargets.filter((t) => t.mode !== 'off')
  const densityTarget = activeDailyTargets.find((t) => t.metric === 'calorie_density')
  const cols = showMore ? [...DEFAULT_COLS, ...OPTIONAL_COLS] : DEFAULT_COLS
  const nameForId = (id: string) => foodById.get(id)?.name ?? 'Unknown food'

  const fullAvgCal = s.fullDayAverage.totals.calories
  const totalMeals = view.days.reduce((n, d) => n + d.cells.length, 0)
  const perMealCounts = view.meals.map((m) => ({
    name: m.name,
    count: view.days.reduce((n, d) => n + d.cells.filter((c) => c.meal.id === m.id).length, 0),
  }))

  return (
    <section className={`${FLAT_TABLE_SURFACE} mb-4`}>
      {/* Headline (always visible) */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-3 py-2 text-sm">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="flex items-center gap-1 font-semibold text-gray-900">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Summary
        </button>
        <span><span className="text-gray-400">Packed weight </span><span className="font-semibold"><WeightCell weight={s.packed.weight} weightUnit={weightUnit} nameForId={nameForId} /></span></span>
        <span><span className="text-gray-400">Full-day average </span><span className="font-semibold">{fullAvgCal.state === 'complete' && s.fullDayAverage.fullDays > 0 ? `${Math.round(fullAvgCal.value)} kcal (${s.fullDayAverage.fullDays} of ${s.fullDayAverage.totalDays} days counted)` : '-'}</span></span>
        <span><span className="text-gray-400">Packed density </span><span className="font-semibold">{formatCalorieDensity(s.packed.calorieDensityPerGram, weightUnit)}</span></span>
        {onEditTargets && <button type="button" onClick={onEditTargets} className="ml-auto font-medium text-emerald-700 hover:underline">Edit targets</button>}
      </div>

      {open && (
        <>
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-gray-500">
            <span>
              {view.days.length} days - {totalMeals} planned meals
              {perMealCounts.length > 0 && (
                <span className="ml-1 text-gray-400">({perMealCounts.map((p) => `${p.name} x${p.count}`).join(', ')})</span>
              )}
            </span>
            <button type="button" onClick={() => setShowMore((v) => !v)} className="font-medium text-emerald-700 hover:underline">
              {showMore ? 'Fewer metrics' : 'More metrics'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={FLAT_TABLE_HEADER}>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Day</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Weight</th>
                  {cols.map((c) => <th key={c.key} scope="col" className="px-2 py-1.5 text-right font-medium">{c.label}</th>)}
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Density</th>
                </tr>
              </thead>
              <tbody>
                {activeDailyTargets.length > 0 && (
                  <tr aria-label="Daily target" className="border-t border-gray-200 text-xs text-gray-500">
                    <th scope="row" className="px-2 py-1.5 text-left font-medium">Target</th>
                    <td className="px-2 py-1.5" />
                    {cols.map((c) => {
                      const m = dailyMetricForNutrientKey(c.key)
                      const t = m ? activeDailyTargets.find((x) => x.metric === m) : undefined
                      return <td key={c.key} className="px-2 py-1.5 text-right tabular-nums">{t ? formatDailyTargetBand(t.metric, t.mode, t.target_min, t.target_max, weightUnit) : ''}</td>
                    })}
                    <td className="px-2 py-1.5 text-right tabular-nums">{densityTarget ? formatDailyTargetBand('calorie_density', densityTarget.mode, densityTarget.target_min, densityTarget.target_max, weightUnit) : ''}</td>
                  </tr>
                )}
                {s.days.map((d, i) => (
                  <tr key={d.dayId} aria-label={`Day ${i + 1}`} className="border-t border-gray-100">
                    <th scope="row" className="px-2 py-1.5 text-left font-normal">
                      Day {i + 1} <span className="text-xs uppercase text-gray-400">{d.dayType}</span>
                    </th>
                    <td className="px-2 py-1.5 text-right"><WeightCell weight={d.weight} weightUnit={weightUnit} nameForId={nameForId} /></td>
                    <NutCells totals={d.totals} cols={cols} nameForId={nameForId} targets={dayTargetMaps[i]} />
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatCalorieDensity(d.calorieDensityPerGram, weightUnit)}
                      {dayTargetMaps[i]?.get('calorie_density') ? <TargetStatusMark status={dayTargetMaps[i]!.get('calorie_density')!.status} /> : null}
                    </td>
                  </tr>
                ))}
                <SummaryRow label="Extras" group={s.extras} cols={cols} weightUnit={weightUnit} nameForId={nameForId} />
                <SummaryRow label="Planned total" group={s.planned} cols={cols} weightUnit={weightUnit} nameForId={nameForId} />
                <tr aria-label="Full-day average" className="border-t border-gray-200 font-medium">
                  <th scope="row" className="px-2 py-1.5 text-left">
                    Full-day average <span className="text-xs font-normal text-gray-400">{s.fullDayAverage.fullDays} of {s.fullDayAverage.totalDays} days counted</span>
                  </th>
                  <td className="px-2 py-1.5 text-right">{s.fullDayAverage.fullDays > 0 ? <WeightCell weight={s.fullDayAverage.weight} weightUnit={weightUnit} nameForId={nameForId} /> : <span className="text-gray-400">-</span>}</td>
                  {cols.map((c) => (
                    <td key={c.key} className="px-2 py-1.5 text-right">
                      {s.fullDayAverage.fullDays > 0
                        ? <NutrientTotalCell total={s.fullDayAverage.totals[c.key]} kind={c.kind} nameForId={nameForId} />
                        : <span className="text-gray-400">-</span>}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.fullDayAverage.fullDays > 0 ? formatCalorieDensity(s.fullDayAverage.calorieDensityPerGram, weightUnit) : '-'}</td>
                </tr>
                <SummaryRow label="Packed total" group={s.packed} cols={cols} weightUnit={weightUnit} nameForId={nameForId} />
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
