import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_HEADER,
  FLAT_TABLE_HEADER_PADDING,
  FLAT_TABLE_QUANTITY_TEXT,
  FLAT_TABLE_SURFACE,
  TABLE_DIVIDER,
} from '../components/flat-table-styles'
import type { FoodItemResponse } from '../../shared/food'

// The shopping list is a COUNT of what's in the plan - the owner's words. One
// row per item: name and × unitCount, nothing else. No weights (a shopping
// list doesn't have weights), no controls, no popups: it is derived output,
// and editing lives in the meal plan, where tapping a food opens the editor.
// unitCount is the server's number (shared/food.ts foodUnitCount), never
// recomputed here, so the tally can never disagree with the pack.
export default function FoodShoppingList({
  items,
}: {
  items: readonly FoodItemResponse[]
}) {
  return (
    <section aria-label="Shopping list" className={FLAT_TABLE_SURFACE}>
      <div className={`${FLAT_TABLE_HEADER} ${FLAT_TABLE_HEADER_PADDING}`}>
        <h3 className={FLAT_TABLE_EYEBROW}>Shopping list</h3>
      </div>
      {items.length === 0 ? (
        <p className={`px-3 py-2.5 ${FLAT_TABLE_BODY_TEXT} text-gray-500`}>
          Nothing planned yet
        </p>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            className={`flex items-baseline gap-2 border-b ${TABLE_DIVIDER} px-3 py-2 lg:py-1.5 last:border-b-0`}
          >
            <span
              className={`min-w-0 flex-1 ${FLAT_TABLE_BODY_TEXT} [overflow-wrap:anywhere] text-gray-900`}
            >
              {item.name}
            </span>
            <span className={`shrink-0 ${FLAT_TABLE_QUANTITY_TEXT} text-gray-700`}>
              × {item.unitCount}
            </span>
          </div>
        ))
      )}
    </section>
  )
}
