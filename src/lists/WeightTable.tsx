import { useMemo } from 'react'
import type { ListItemWithGear, Category } from '../lib/types'
import { computeWeightBreakdown } from '../lib/weight-breakdown'
import {
  COMPACT_PANEL_BODY_TEXT,
  TABLE_DIVIDER_LINE,
  TABLE_STRONG_DIVIDER,
} from '../components/flat-table-styles'
import TotalWeightValue from '../components/TotalWeightValue'

type Props = {
  items: ListItemWithGear[]
  categories: Category[]
}

function fmtG(grams: number): string {
  return `${grams} g`
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
  // font-mono + tabular-nums so mixed weight strings ("1 lb 4.0 oz", "15.2 oz",
  // "800 g") align column-wise. Labels stay proportional. Matches the
  // FLAT_TABLE_NUMERIC_TEXT contract for row value cells; this surface keeps
  // its layout (py-px, px-2, text-right) inline since the WeightTable cell
  // pattern only lives here.
  const valueCell = 'py-px px-2 text-right text-xs font-mono tabular-nums'

  return (
    <table className={`w-full ${COMPACT_PANEL_BODY_TEXT} text-gray-700`}>
        <tbody className={`divide-y ${TABLE_DIVIDER_LINE}`}>
          {catRows.map((row) => (
            <tr key={row.id}>
              <td className={labelCell}>{row.name}</td>
              <td className={valueCell}>{fmtG(row.grams)}</td>
              <td className={valueCell}><TotalWeightValue grams={row.grams} unit="oz" /></td>
            </tr>
          ))}
        </tbody>
        <tfoot className={`divide-y ${TABLE_DIVIDER_LINE} border-t-2 ${TABLE_STRONG_DIVIDER}`}>
          <tr className="font-semibold">
            <td className={labelCell}>Base weight</td>
            <td className={valueCell}>{fmtG(baseGrams)}</td>
            <td className={valueCell}><TotalWeightValue grams={baseGrams} unit="oz" /></td>
          </tr>
          {consumableGrams > 0 && (
            <tr>
              <td className={labelCell}>Consumables</td>
              <td className={valueCell}>{fmtG(consumableGrams)}</td>
              <td className={valueCell}><TotalWeightValue grams={consumableGrams} unit="oz" /></td>
            </tr>
          )}
          {wornGrams > 0 && (
            <tr className="text-gray-400">
              <td className={labelCell}>Worn (not added)</td>
              <td className={valueCell}>{fmtG(wornGrams)}</td>
              <td className={valueCell}><TotalWeightValue grams={wornGrams} unit="oz" /></td>
            </tr>
          )}
          <tr className={`font-semibold border-t-2 ${TABLE_STRONG_DIVIDER}`}>
            <td className={labelCell}>Total pack weight</td>
            <td className={valueCell}>{fmtG(totalPackGrams)}</td>
            <td className={valueCell}><TotalWeightValue grams={totalPackGrams} unit="oz" /></td>
          </tr>
        </tfoot>
    </table>
  )
}
