import { formatTotalWeight, gramsToLbOzParts, type WeightUnit } from '../lib/weight'
import ItemWeightValue from './ItemWeightValue'

type Props = {
  grams: number
  unit: WeightUnit
}

// The AGGREGATE weight display: category footers, the food day total, the
// Weight summary stats, and the WeightTable cells. In imperial it uses the
// compound lb+oz form once a value crosses 1 lb (formatTotalWeight); per-row
// weights use ItemWeightValue's plain-ounce form instead. Both components
// share one geometry - number right-aligned in a fixed cell, 4px gap, unit in
// its own cell - so totals sit on the same digit rail as the rows they sum.
// The one sanctioned exception is FoodView's inline "Food weight" roll-up,
// which renders plain text and says why at its call site.
export default function TotalWeightValue({ grams, unit }: Props) {
  // A gram total formats exactly like a gram item weight, so the grams branch
  // IS the row renderer: one implementation of the number/unit cells, not a
  // string copy that can drift (it did - a bare "210 g" in the mono footer
  // font put ~7px between number and unit where every row has 4px).
  if (unit === 'g') return <ItemWeightValue grams={grams} unit="g" />

  const label = formatTotalWeight(grams, unit)
  const { lb, oz } = gramsToLbOzParts(grams)

  return (
    <span aria-label={label} className="inline-block whitespace-nowrap">
      <span
        aria-hidden="true"
        className="inline-grid grid-cols-[3ch_2ch_5ch_2ch] justify-end gap-x-1"
      >
        {lb > 0 ? (
          <>
            <span className="text-right">{lb}</span>
            <span className="text-left">lb</span>
          </>
        ) : (
          <>
            <span />
            <span />
          </>
        )}
        <span className="text-right">{oz.toFixed(1)}</span>
        <span className="text-left">oz</span>
      </span>
    </span>
  )
}
