import TotalWeightValue from '../components/TotalWeightValue'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_BODY_TEXT_MUTED,
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_ROW,
  FLAT_TABLE_ROW_PADDING,
  FLAT_TABLE_SURFACE,
} from '../components/flat-table-styles'
import { useWeightUnit } from '../lib/use-weight-unit'

type Props = { grams: number }

// Single derived row for public Gear shares: total carried food WEIGHT only,
// no menu. The caller folds these grams into the weight breakdown as consumable
// (withProjectedFood), so this component is purely presentational. Labeled
// "Food" (not "Food plan"): this is the packed food weight, not the planner.
export default function FoodSummaryRow({ grams }: Props) {
  const { weightUnit } = useWeightUnit()
  return (
    <section className={FLAT_TABLE_SURFACE} aria-label="Food carried from plan">
      <div className={`${FLAT_TABLE_ROW} ${FLAT_TABLE_ROW_PADDING} gap-2 bg-white`}>
        <div className="min-w-0 flex-1">
          <div className={`${FLAT_TABLE_BODY_TEXT} text-gray-900`}>Food</div>
          <div className={FLAT_TABLE_BODY_TEXT_MUTED}>From Food plan</div>
        </div>
        <div className={`${FLAT_TABLE_NUMERIC_TEXT} min-w-20 text-right text-gray-700`}>
          <TotalWeightValue grams={grams} unit={weightUnit} />
        </div>
      </div>
    </section>
  )
}
