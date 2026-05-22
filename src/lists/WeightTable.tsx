import { useMemo } from 'react'
import type { ListItemWithGear, Category } from '../lib/types'
import { gramsToLbOzParts } from '../lib/weight'
import { computeWeightBreakdown } from '../lib/weight-breakdown'
import { TABLE_STRONG_DIVIDER } from '../components/flat-table-styles'

type Props = {
  items: ListItemWithGear[]
  categories: Category[]
}

function fmtG(grams: number): string {
  return `${grams} g`
}

function fmtLbOz(grams: number): string {
  const { lb, oz } = gramsToLbOzParts(grams)
  if (lb > 0) return `${lb} lb ${oz.toFixed(1)} oz`
  return `${oz.toFixed(1)} oz`
}

export default function WeightTable({ items, categories }: Props) {
  // Hook must be called unconditionally; the empty-list early return moved
  // below the memo. The memo guards against unrelated parent re-renders
  // (notes editor keystroke, dialog open/close) recomputing the breakdown
  // — pack-mode toggles still rebuild because `items` reference changes
  // there, but those are the renders where the breakdown legitimately
  // changes anyway.
  const breakdown = useMemo(
    () => computeWeightBreakdown(items, categories),
    [items, categories],
  )

  if (items.length === 0) return null

  const { catRows, baseGrams, consumableGrams, wornGrams, totalPackGrams } = breakdown

  const labelCell = 'py-px pl-3 pr-2'
  const valueCell = 'py-px px-2 text-right tabular-nums'

  return (
    <table className="w-full text-xs text-gray-700">
        <tbody className="divide-y divide-gray-50">
          {catRows.map((row) => (
            <tr key={row.id}>
              <td className={labelCell}>{row.name}</td>
              <td className={valueCell}>{fmtG(row.grams)}</td>
              <td className={valueCell}>{fmtLbOz(row.grams)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className={`divide-y divide-gray-100 border-t-2 ${TABLE_STRONG_DIVIDER}`}>
          <tr className="font-semibold">
            <td className={labelCell}>Base weight</td>
            <td className={valueCell}>{fmtG(baseGrams)}</td>
            <td className={valueCell}>{fmtLbOz(baseGrams)}</td>
          </tr>
          {consumableGrams > 0 && (
            <tr>
              <td className={labelCell}>Consumables</td>
              <td className={valueCell}>{fmtG(consumableGrams)}</td>
              <td className={valueCell}>{fmtLbOz(consumableGrams)}</td>
            </tr>
          )}
          {wornGrams > 0 && (
            <tr className="text-gray-400">
              <td className={labelCell}>Worn (not added)</td>
              <td className={valueCell}>{fmtG(wornGrams)}</td>
              <td className={valueCell}>{fmtLbOz(wornGrams)}</td>
            </tr>
          )}
          <tr className={`font-semibold border-t-2 ${TABLE_STRONG_DIVIDER}`}>
            <td className={labelCell}>Total pack weight</td>
            <td className={valueCell}>{fmtG(totalPackGrams)}</td>
            <td className={valueCell}>{fmtLbOz(totalPackGrams)}</td>
          </tr>
        </tfoot>
    </table>
  )
}
