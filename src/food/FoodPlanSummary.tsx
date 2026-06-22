import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, PackagePlus, Table as TableIcon } from 'lucide-react'
import { useWeightUnit } from '../lib/use-weight-unit'
import { type WeightUnit } from '../lib/weight'
import type { FoodItem, FoodPlanDailyTarget, DailyTargetMetric } from '../lib/types'
import type { GroupSummary, NutrientKey, NutrientTotal, TripSummary } from '../lib/food/nutrition'
import { resolveDailyTargets, dailyMetricForNutrientKey, type ResolvedTarget } from '../lib/food/targets'
import { formatCalorieDensity, formatDailyTargetBand } from './nutrition-format'
import TargetStatusMark from './TargetStatusMark'
import { FLAT_TABLE_SURFACE, FLAT_TABLE_EYEBROW, FLAT_TABLE_NUMERIC_TEXT } from '../components/flat-table-styles'
import NutrientTotalCell, { WeightCell, type NutrientCellKind } from './NutrientTotalCell'

// Column-order grammar for the Food Plan document. Weight is grampacker's
// cross-cutting packing metric, so it is visually anchored at the FAR RIGHT
// wherever a table/row includes it. This all-days table reads:
//   Day | <nutrition metrics> | density | Weight
// and keeps that shape when More metrics is open (Day first, nutrition metrics
// in the middle, density near the end, Weight last). Chunk 2 carries the same
// rule into the day/meal/entry rows below: entry rows are
//   Food | Quantity | Calories | Weight | Actions
// and day/meal headers keep weight as the farthest-right metric when present.
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
          <td key={c.key} className="whitespace-nowrap px-2.5 py-1.5 text-right">
            <NutrientTotalCell total={totals[c.key]} kind={c.kind} nameForId={nameForId} />
            {rt ? <TargetStatusMark status={rt.status} /> : null}
          </td>
        )
      })}
    </>
  )
}

function SummaryRow({ label, group, cols, weightUnit, nameForId, href, icon }: {
  label: string
  group: GroupSummary
  cols: Col[]
  weightUnit: WeightUnit
  nameForId: (id: string) => string
  href?: string
  icon?: ReactNode
}) {
  // The icon is decorative; aria-label on the row and the link text keep the
  // accessible name as the bare label (e.g. "Extras").
  const labelContent = icon ? <span className="inline-flex items-center gap-1">{icon}{label}</span> : label
  return (
    <tr aria-label={label} className="border-t border-gray-200 font-medium">
      <th scope="row" className="whitespace-nowrap px-2.5 py-1.5 text-left">
        {href ? <a href={href} className="text-blue-600 hover:underline">{labelContent}</a> : labelContent}
      </th>
      <NutCells totals={group.totals} cols={cols} nameForId={nameForId} />
      <td className={`whitespace-nowrap px-2.5 py-1.5 text-right ${FLAT_TABLE_NUMERIC_TEXT}`}>{formatCalorieDensity(group.calorieDensityPerGram, weightUnit)}</td>
      <td className="whitespace-nowrap px-2.5 py-1.5 text-right"><WeightCell weight={group.weight} weightUnit={weightUnit} nameForId={nameForId} /></td>
    </tr>
  )
}

// Small pill on a partial day's row. Full days carry no marker (the absence is
// the signal); only partial days are called out, matching the day-section header.
function PartialPill() {
  return (
    <span
      title="Partial day - not counted in the full-day average or daily target check."
      className="inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500"
    >
      Partial
    </span>
  )
}

export default function FoodPlanSummary({
  summary, foodById, dailyTargets,
}: {
  summary: TripSummary
  foodById: Map<string, FoodItem>
  dailyTargets: FoodPlanDailyTarget[]
}) {
  const { weightUnit } = useWeightUnit()
  const densityLabel = weightUnit === 'oz' ? 'kcal/oz' : 'kcal/g'
  const [open, setOpen] = useState(true)
  const [showMore, setShowMore] = useState(false)
  const s = summary
  const dayTargetMaps = useMemo(
    () => s.days.map((d) => resolveDailyTargets(dailyTargets, d.totals, d.calorieDensityPerGram, d.dayType)),
    [s, dailyTargets],
  )
  // "Active" = a target the user actually configured. An explicit `off` row must
  // NOT render a Target band or a glyph - filter it before deciding what to show.
  const activeDailyTargets = dailyTargets.filter((t) => t.mode !== 'off')
  const densityTarget = activeDailyTargets.find((t) => t.metric === 'calorie_density')
  const cols = showMore ? [...DEFAULT_COLS, ...OPTIONAL_COLS] : DEFAULT_COLS
  const nameForId = (id: string) => foodById.get(id)?.name ?? 'Unknown food'

  return (
    <section className={FLAT_TABLE_SURFACE}>
      {/* Collapsible headline. The packed-weight / full-day-average / density
          reconciliation now lives in the stat strip above; this only toggles the
          per-day table, so the headline stays a single quiet control. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <TableIcon size={15} className="shrink-0 text-gray-400" aria-hidden="true" />
        <span className="text-sm font-semibold text-gray-900">All-days summary</span>
        <span className="hidden text-xs text-gray-400 sm:inline">per-day totals, Extras, and Planned / Full-day-average / Packed reconciliation</span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-blue-600">
          {open ? 'Hide' : 'Show'} table {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {open && (
        <>
          <div className="flex items-center justify-end border-t border-gray-100 px-3 py-1.5">
            <button type="button" onClick={() => setShowMore((v) => !v)} className="text-xs font-medium text-blue-600 hover:underline">
              {showMore ? 'Fewer metrics' : 'More metrics'}
            </button>
          </div>

          {/* width:100% + a per-column-count minWidth is the archive's table
              recipe: on desktop the columns spread to fill the wide panel and the
              header cells sit directly above their numeric columns; below the
              minWidth (mobile) the wrapper scrolls horizontally instead of
              cramming. border-collapse so the per-row hairlines render. */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" style={{ minWidth: showMore ? 760 : 620 }}>
              <thead>
                <tr className="border-b border-gray-200">
                  <th scope="col" className={`whitespace-nowrap px-2.5 py-1.5 text-left ${FLAT_TABLE_EYEBROW}`}>Day</th>
                  {cols.map((c) => <th key={c.key} scope="col" className={`whitespace-nowrap px-2.5 py-1.5 text-right ${FLAT_TABLE_EYEBROW}`}>{c.label}</th>)}
                  <th scope="col" className={`whitespace-nowrap px-2.5 py-1.5 text-right ${FLAT_TABLE_EYEBROW}`}>{densityLabel}</th>
                  <th scope="col" className={`whitespace-nowrap px-2.5 py-1.5 text-right ${FLAT_TABLE_EYEBROW}`}>Weight</th>
                </tr>
              </thead>
              <tbody>
                {activeDailyTargets.length > 0 && (
                  <tr aria-label="Daily target" className="border-t border-gray-200 text-xs text-gray-500">
                    <th scope="row" className="whitespace-nowrap px-2.5 py-1.5 text-left font-medium">Target</th>
                    {cols.map((c) => {
                      const m = dailyMetricForNutrientKey(c.key)
                      const t = m ? activeDailyTargets.find((x) => x.metric === m) : undefined
                      return <td key={c.key} className={`whitespace-nowrap px-2.5 py-1.5 text-right ${FLAT_TABLE_NUMERIC_TEXT}`}>{t ? formatDailyTargetBand(t.metric, t.mode, t.target_min, t.target_max, weightUnit) : ''}</td>
                    })}
                    <td className={`whitespace-nowrap px-2.5 py-1.5 text-right ${FLAT_TABLE_NUMERIC_TEXT}`}>{densityTarget ? formatDailyTargetBand('calorie_density', densityTarget.mode, densityTarget.target_min, densityTarget.target_max, weightUnit) : ''}</td>
                    {/* empty Weight cell - Target band applies to nutrition/density, not pack weight */}
                    <td className="px-2.5 py-1.5" />
                  </tr>
                )}
                {s.days.map((d, i) => (
                  <tr key={d.dayId} aria-label={`Day ${i + 1}`} className="border-t border-gray-100">
                    <th scope="row" className="whitespace-nowrap px-2.5 py-1.5 text-left font-normal">
                      <span className="inline-flex items-center gap-1.5">
                        <a href={`#food-day-${d.dayId}`} className="text-blue-600 hover:underline">Day {i + 1}</a>
                        {d.dayType === 'partial' ? <PartialPill /> : null}
                      </span>
                    </th>
                    <NutCells totals={d.totals} cols={cols} nameForId={nameForId} targets={dayTargetMaps[i]} />
                    <td className={`whitespace-nowrap px-2.5 py-1.5 text-right ${FLAT_TABLE_NUMERIC_TEXT}`}>
                      {formatCalorieDensity(d.calorieDensityPerGram, weightUnit)}
                      {dayTargetMaps[i]?.get('calorie_density') ? <TargetStatusMark status={dayTargetMaps[i]!.get('calorie_density')!.status} /> : null}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right"><WeightCell weight={d.weight} weightUnit={weightUnit} nameForId={nameForId} /></td>
                  </tr>
                ))}
                <SummaryRow label="Extras" icon={<PackagePlus size={12} className="text-gray-400" aria-hidden="true" />} group={s.extras} cols={cols} weightUnit={weightUnit} nameForId={nameForId} href="#food-extras" />
                <SummaryRow label="Planned total" group={s.planned} cols={cols} weightUnit={weightUnit} nameForId={nameForId} />
                <tr aria-label="Full-day average" className="border-t border-gray-200 font-medium">
                  <th scope="row" className="whitespace-nowrap px-2.5 py-1.5 text-left">
                    Full-day average <span className="text-xs font-normal text-gray-400">{s.fullDayAverage.fullDays} of {s.fullDayAverage.totalDays} days counted</span>
                  </th>
                  {cols.map((c) => (
                    <td key={c.key} className="whitespace-nowrap px-2.5 py-1.5 text-right">
                      {s.fullDayAverage.fullDays > 0
                        ? <NutrientTotalCell total={s.fullDayAverage.totals[c.key]} kind={c.kind} nameForId={nameForId} />
                        : <span className="text-gray-400">-</span>}
                    </td>
                  ))}
                  <td className={`whitespace-nowrap px-2.5 py-1.5 text-right ${FLAT_TABLE_NUMERIC_TEXT}`}>{s.fullDayAverage.fullDays > 0 ? formatCalorieDensity(s.fullDayAverage.calorieDensityPerGram, weightUnit) : '-'}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right">{s.fullDayAverage.fullDays > 0 ? <WeightCell weight={s.fullDayAverage.weight} weightUnit={weightUnit} nameForId={nameForId} /> : <span className="text-gray-400">-</span>}</td>
                </tr>
                <SummaryRow label="Packed total" group={s.packed} cols={cols} weightUnit={weightUnit} nameForId={nameForId} />
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" /> on target</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" /> outside target</span>
            <span className="inline-flex items-center gap-1"><PartialPill /> excluded from the full-day average</span>
          </div>
        </>
      )}
    </section>
  )
}
