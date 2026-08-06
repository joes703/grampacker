import { Link } from 'react-router'
import {
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_ROW,
  FLAT_TABLE_SURFACE,
} from '../components/flat-table-styles'
import ItemWeightValue from '../components/ItemWeightValue'
import { foodGramsFor } from '../lib/weight-breakdown'
import type { ListFoodResponse } from '../../shared/food'
import type { WeightUnit } from '../lib/weight'

// The List/Pack-view trace of the Food view. Food weight counts toward the
// totals shown on those views (withFoodWeight), and a weight contributor with
// no visible source is a trap - so the row stays behind when the planner
// moves to /lists/:id/food. Derived, never editable here.
export default function FoodSummaryRow({
  listId,
  food,
  weightUnit,
}: {
  listId: string
  food: ListFoodResponse
  weightUnit: WeightUnit
}) {
  const grams = foodGramsFor(food.items)
  return (
    <section aria-label="Food summary" className={`mt-3 ${FLAT_TABLE_SURFACE}`}>
      <Link
        to={`/lists/${listId}/food`}
        className={`${FLAT_TABLE_ROW} flex items-center gap-2 hover:bg-gray-50`}
      >
        <span className={`flex-1 ${FLAT_TABLE_HEADER_TITLE}`}>Food</span>
        {food.dayCount > 0 && (
          <span className={FLAT_TABLE_META_TEXT}>
            {food.dayCount} {food.dayCount === 1 ? 'day' : 'days'}
          </span>
        )}
        {food.items.length > 0 ? (
          <ItemWeightValue grams={grams} unit={weightUnit} />
        ) : (
          // Days without items is still zero carried weight - say so rather
          // than render a row that trails off after the day count.
          <span className={FLAT_TABLE_META_TEXT}>none yet</span>
        )}
      </Link>
    </section>
  )
}
