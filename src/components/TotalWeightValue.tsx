import { formatTotalWeight, gramsToLbOzParts, type WeightUnit } from '../lib/weight'

type Props = {
  grams: number
  unit: WeightUnit
}

export default function TotalWeightValue({ grams, unit }: Props) {
  if (unit === 'g') return <>{formatTotalWeight(grams, unit)}</>

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
