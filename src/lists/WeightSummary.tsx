import { ChevronRight } from 'lucide-react'
import type { Category, ListItemWithGear } from '../lib/types'
import { type WeightBreakdown } from '../lib/weight-breakdown'
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
  /** REQUIRED, and only obtainable from computeListWeightBreakdown. */
  breakdown: WeightBreakdown
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
// Math comes in already finished, from computeListWeightBreakdown in
// lib/weight-breakdown.ts; this component owns presentation only. It does NOT
// compute a fallback - that fallback was gear-only, so forgetting to pass a
// breakdown used to render a total quietly missing food.
//
export default function WeightSummary({
  items,
  categories,
  breakdown,
}: Props) {
  if (items.length === 0 && breakdown.totalPackGrams === 0) return null

  return (
    <>
      {/* Mobile / tablet portrait — compact strip + collapsible table. */}
      <div className="lg:hidden flex flex-col gap-2">
        <SummaryStrip breakdown={breakdown} />
        <BreakdownDisclosure>
          <WeightTable items={items} categories={categories} breakdown={breakdown} />
        </BreakdownDisclosure>
      </div>

      {/* Desktop — same panel as before. */}
      <div className="hidden lg:block">
        <PanelCard title="Weight summary">
          <WeightTable items={items} categories={categories} breakdown={breakdown} />
          </PanelCard>
      </div>
    </>
  )
}


function SummaryStrip({ breakdown }: { breakdown: WeightBreakdown }) {
  const { weightUnit } = useWeightUnit()
  // All four buckets, always rendered - a 0 g Worn stat stays put rather
  // than appearing when a flag flips, so the layout never shifts under a
  // tap. Worn sits beside Base because both describe gear you take that
  // the pack total does not carry on your back the same way.
  return (
    <div className={`grid grid-cols-4 divide-x divide-gray-100 ${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG}`}>
      <Stat label="Base" grams={breakdown.baseGrams} unit={weightUnit} />
      <Stat label="Worn" grams={breakdown.wornGrams} unit={weightUnit} />
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

// A native <details>: closed by default, toggled by its summary, with the
// browser's own disclosure semantics and keyboard support.
function BreakdownDisclosure({ children }: { children: React.ReactNode }) {
  return (
    <details className={`group ${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG} overflow-hidden`}>
      <summary
        className={`flex w-full cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-left [&::-webkit-details-marker]:hidden ${FLAT_TABLE_EYEBROW} ${TABLE_HEADER_BG} hover:bg-gray-100`}
      >
        <ChevronRight size={14} className="group-open:rotate-90" />
        <span>Weight breakdown</span>
      </summary>
      <div className={`border-t ${TABLE_DIVIDER} py-1`}>{children}</div>
    </details>
  )
}
