import { formatGrams, formatItemWeight, gramsToOz, type WeightUnit } from '../lib/weight'

type Props = {
  grams: number
  unit: WeightUnit
}

// The PER-ROW weight display: item rows, picker rows, and meal subtotals.
// In imperial it stays plain ounces; aggregates (footers, summary stats) use
// TotalWeightValue, which switches to compound lb+oz past 1 lb. The two share
// this geometry - number right-aligned in a fixed-width cell, a 4px grid gap,
// unit in its own cell - which is what keeps digits on one rail down a column
// and the number-to-unit gap identical on every surface. Render weights
// through one of these two components, not with a formatted string.
export default function ItemWeightValue({ grams, unit }: Props) {
  const label = formatItemWeight(grams, unit)

  if (unit === 'g') {
    return (
      <span aria-label={label} className="inline-block whitespace-nowrap">
        <span
          aria-hidden="true"
          className="inline-grid grid-cols-[5ch_1ch] justify-end gap-x-1"
        >
          <span className="text-right">{formatGrams(grams)}</span>
          <span className="text-left">g</span>
        </span>
      </span>
    )
  }

  return (
    <span aria-label={label} className="inline-block whitespace-nowrap">
      <span
        aria-hidden="true"
        className="inline-grid grid-cols-[5ch_2ch] justify-end gap-x-1"
      >
        <span className="text-right">{gramsToOz(grams).toFixed(1)}</span>
        <span className="text-left">oz</span>
      </span>
    </span>
  )
}
