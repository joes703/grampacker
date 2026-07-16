import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Category, ListItemWithGear } from '../lib/types'
import { computeWeightBreakdown, type WeightBreakdown } from '../lib/weight-breakdown'
import { useWeightUnit } from '../lib/use-weight-unit'
import {
  COMPACT_PANEL_META_TEXT,
  FLAT_TABLE_EYEBROW,
  TABLE_BORDER,
  TABLE_DIVIDER,
  TABLE_HEADER_BG,
  TABLE_RADIUS,
  TABLE_SURFACE_BG,
} from '../components/flat-table-styles'
import TotalWeightValue from '../components/TotalWeightValue'
import PanelCard from './PanelCard'
import WeightTable from './WeightTable'

type Props = {
  items: ListItemWithGear[]
  categories: Category[]
  breakdown?: WeightBreakdown
  // The attached food plan could not be fully projected, so every number here
  // that includes food is an UNDERCOUNT (design 5.4). The fact has to travel
  // with the number, not sit only on the Food row: this strip is what people
  // read the pack weight off.
  incompleteFood?: boolean
}

// Weight summary rendered below Notes on the list detail page (normal
// view only — pack mode hides the whole section via its parent).
//
// Two presentations of the same data:
//   - Below lg: compact three-stat strip (Base / Total / Consumable) +
//     a collapsed "Weight breakdown" disclosure that opens the detailed
//     per-category table. Open state is component-local React state so
//     it persists while the page stays mounted (no localStorage; pack-
//     mode toggle and route changes legitimately reset it).
//   - lg and above: existing PanelCard("Weight summary") wrapping the
//     detailed table, always visible — unchanged from the previous
//     layout.
//
// Empty lists collapse to nothing on every viewport (ListDetailPage
// already widens Notes to full width in that case via grid-cols).
//
// Math is shared with the desktop table via computeWeightBreakdown in
// lib/weight-breakdown.ts; this component owns presentation only.
//
export default function WeightSummary({
  items,
  categories,
  breakdown: providedBreakdown,
  incompleteFood = false,
}: Props) {
  const computedBreakdown = useMemo(
    () => computeWeightBreakdown(items, categories),
    [items, categories],
  )
  const breakdown = providedBreakdown ?? computedBreakdown
  const [breakdownOpen, setBreakdownOpen] = useState(false)

  // An all-unprojectable food plan weighs 0 with no gear, but it is NOT nothing
  // to report: the note is the only thing telling the user the total is an
  // undercount rather than an accurate zero.
  if (items.length === 0 && breakdown.totalPackGrams === 0 && !incompleteFood) return null

  return (
    <>
      {/* Mobile / tablet portrait — compact strip + collapsible table. */}
      <div className="lg:hidden flex flex-col gap-2">
        <SummaryStrip breakdown={breakdown} />
        {incompleteFood && <IncompleteFoodWeightNote />}
        <BreakdownDisclosure
          open={breakdownOpen}
          onToggle={() => setBreakdownOpen((v) => !v)}
        >
          <WeightTable items={items} categories={categories} breakdown={breakdown} />
        </BreakdownDisclosure>
      </div>

      {/* Desktop — same panel as before. */}
      <div className="hidden lg:block">
        <PanelCard title="Weight summary">
          <WeightTable items={items} categories={categories} breakdown={breakdown} />
          {incompleteFood && <IncompleteFoodWeightNote />}
        </PanelCard>
      </div>
    </>
  )
}

// Says the pack weight is an undercount. A total that quietly lies is worse
// than one that admits it is partial.
//
// The wording deliberately does not name a cause. design 5.4 says the only
// cause is a `packages` entry whose food has no package size - but
// selectFoodPlanView ALSO flags incomplete for an entry whose food is missing
// from the ['food-items'] cache (src/food/plan-view.ts:110), which is a stale
// client cache rather than missing data. Naming the package-size cause would be
// a confident lie in that case. The editor's badge is generic for the same
// reason; the two should be pulled apart in plan-view, not papered over here.
function IncompleteFoodWeightNote() {
  return (
    <p className="px-3 py-2 text-xs text-amber-800">
      Estimate: some foods in this plan could not be weighed, so they add nothing
      to this total.
    </p>
  )
}

function SummaryStrip({ breakdown }: { breakdown: WeightBreakdown }) {
  const { weightUnit } = useWeightUnit()
  return (
    <div className={`grid grid-cols-3 divide-x divide-gray-100 ${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG}`}>
      <Stat label="Base" grams={breakdown.baseGrams} unit={weightUnit} />
      <Stat label="Consumable" grams={breakdown.consumableGrams} unit={weightUnit} />
      <Stat label="Pack total" grams={breakdown.totalPackGrams} unit={weightUnit} />
    </div>
  )
}

function Stat({
  label,
  grams,
  unit,
}: {
  label: string
  grams: number
  unit: 'g' | 'oz'
}) {
  return (
    <div className="px-3 py-2 text-center">
      <p className={FLAT_TABLE_EYEBROW}>{label}</p>
      <p className={`mt-0.5 ${COMPACT_PANEL_META_TEXT} text-gray-900`}>
        <TotalWeightValue grams={grams} unit={unit} />
      </p>
    </div>
  )
}

function BreakdownDisclosure({
  open,
  onToggle,
  children,
}: {
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className={`${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG} overflow-hidden`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full items-center gap-1.5 px-3 py-2 text-left ${FLAT_TABLE_EYEBROW} ${TABLE_HEADER_BG} hover:bg-gray-100`}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Weight breakdown</span>
      </button>
      {open && (
        <div className={`border-t ${TABLE_DIVIDER} py-1`}>{children}</div>
      )}
    </div>
  )
}
