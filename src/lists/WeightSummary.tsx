import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Category, ListItemWithGear } from '../lib/types'
import { computeWeightBreakdown, type WeightBreakdown } from '../lib/weight-breakdown'
import { formatTotalWeight } from '../lib/weight'
import { useWeightUnit } from '../lib/use-weight-unit'
import PanelCard from './PanelCard'
import WeightTable from './WeightTable'

type Props = {
  items: ListItemWithGear[]
  categories: Category[]
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
// Math is shared with the SharePage and the desktop table via
// computeWeightBreakdown in lib/weight-breakdown.ts; this component
// owns presentation only.
export default function WeightSummary({ items, categories }: Props) {
  const breakdown = useMemo(
    () => computeWeightBreakdown(items, categories),
    [items, categories],
  )
  const [breakdownOpen, setBreakdownOpen] = useState(false)

  if (items.length === 0) return null

  return (
    <>
      {/* Mobile / tablet portrait — compact strip + collapsible table. */}
      <div className="lg:hidden flex flex-col gap-2">
        <SummaryStrip breakdown={breakdown} />
        <BreakdownDisclosure
          open={breakdownOpen}
          onToggle={() => setBreakdownOpen((v) => !v)}
        >
          <WeightTable items={items} categories={categories} />
        </BreakdownDisclosure>
      </div>

      {/* Desktop — same panel as before. */}
      <div className="hidden lg:block">
        <PanelCard title="Weight summary">
          <WeightTable items={items} categories={categories} />
        </PanelCard>
      </div>
    </>
  )
}

function SummaryStrip({ breakdown }: { breakdown: WeightBreakdown }) {
  const { weightUnit } = useWeightUnit()
  return (
    <div className="grid grid-cols-3 divide-x divide-gray-100 rounded-lg border border-gray-200 bg-white">
      <Stat label="Base" grams={breakdown.baseGrams} unit={weightUnit} />
      <Stat label="Total" grams={breakdown.totalPackGrams} unit={weightUnit} />
      <Stat label="Consumable" grams={breakdown.consumableGrams} unit={weightUnit} />
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
    <div className="px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums text-gray-900">
        {formatTotalWeight(grams, unit)}
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
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-50"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Weight breakdown</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 py-1">{children}</div>
      )}
    </div>
  )
}
