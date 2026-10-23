import type { ListItemWithGear, Category } from '../lib/types'
import { type WeightBreakdown } from '../lib/weight-breakdown'
import {
  COMPACT_PANEL_BODY_TEXT,
  TABLE_DIVIDER_LINE,
  TABLE_STRONG_DIVIDER,
} from '../components/flat-table-styles'
import TotalWeightValue from '../components/TotalWeightValue'

type Props = {
  items: ListItemWithGear[]
  categories: Category[]
  /** REQUIRED, and only obtainable from computeListWeightBreakdown. This used
   *  to be optional with a gear-only fallback computed here, which meant any
   *  caller that forgot to pass one silently rendered a total missing food. */
  breakdown: WeightBreakdown
}

// The summary table intentionally presents gram aggregates as whole numbers.
// Keep this display-only: the breakdown and ounce conversion retain the full
// stored precision. Rendering goes through TotalWeightValue so the gram cells
// share the ounce cells' number/unit geometry instead of a string copy.
function GramCell({ grams }: { grams: number }) {
  return <TotalWeightValue grams={Math.round(grams)} unit="g" />
}

export default function WeightTable({ items, breakdown }: Props) {
  if (items.length === 0 && breakdown.totalPackGrams === 0 && breakdown.wornGrams === 0) return null

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
              <td className={valueCell}><GramCell grams={row.grams} /></td>
              <td className={valueCell}><TotalWeightValue grams={row.grams} unit="oz" /></td>
            </tr>
          ))}
        </tbody>
        <tfoot className={`divide-y ${TABLE_DIVIDER_LINE} border-t-2 ${TABLE_STRONG_DIVIDER}`}>
          <tr className="font-semibold">
            <td className={labelCell}>Base weight</td>
            <td className={valueCell}><GramCell grams={baseGrams} /></td>
            <td className={valueCell}><TotalWeightValue grams={baseGrams} unit="oz" /></td>
          </tr>
          {consumableGrams > 0 && (
            <tr>
              <td className={labelCell}>Consumables</td>
              <td className={valueCell}><GramCell grams={consumableGrams} /></td>
              <td className={valueCell}><TotalWeightValue grams={consumableGrams} unit="oz" /></td>
            </tr>
          )}
          {wornGrams > 0 && (
            <tr className="text-gray-500">
              <td className={labelCell}>Worn (not added)</td>
              <td className={valueCell}><GramCell grams={wornGrams} /></td>
              <td className={valueCell}><TotalWeightValue grams={wornGrams} unit="oz" /></td>
            </tr>
          )}
          <tr className={`font-semibold border-t-2 ${TABLE_STRONG_DIVIDER}`}>
            <td className={labelCell}>Total pack weight</td>
            <td className={valueCell}><GramCell grams={totalPackGrams} /></td>
            <td className={valueCell}><TotalWeightValue grams={totalPackGrams} unit="oz" /></td>
          </tr>
        </tfoot>
    </table>
  )
}
