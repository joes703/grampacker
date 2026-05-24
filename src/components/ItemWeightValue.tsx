import { formatItemWeight, gramsToOz, type WeightUnit } from '../lib/weight'

type Props = {
  grams: number
  unit: WeightUnit
}

export default function ItemWeightValue({ grams, unit }: Props) {
  const label = formatItemWeight(grams, unit)

  if (unit === 'g') {
    return (
      <span aria-label={label} className="inline-block whitespace-nowrap">
        <span
          aria-hidden="true"
          className="inline-grid grid-cols-[5ch_1ch] justify-end gap-x-1"
        >
          <span className="text-right">{grams}</span>
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
