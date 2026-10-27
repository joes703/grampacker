import {
  DESKTOP_ROW_HEIGHT,
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_FOOTER_LABEL,
  FLAT_TABLE_FOOTER_ROW,
  FLAT_TABLE_FOOTER_VALUE,
  FLAT_TABLE_HEADER,
  FLAT_TABLE_HEADER_PADDING,
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_QUANTITY_TEXT,
  FLAT_TABLE_SURFACE,
  MOBILE_ROW_HEIGHT,
} from '../components/flat-table-styles'
import ItemWeightValue from '../components/ItemWeightValue'
import TotalWeightValue from '../components/TotalWeightValue'
import { foodGramsAtOneMeal } from '../lib/weight-breakdown'
import { MEAL_LABELS } from './FoodMealGrid'
import type { FoodItemResponse, FoodSlotResponse } from '../../shared/food'
import type { WeightUnit } from '../lib/weight'

// One day of the meal plan, rendered as its own flat table in the same
// grammar as a category section: a FLAT_TABLE_SURFACE card, a header strip
// that doubles as the Qty / Weight column header, and a footer total under
// the Weight column. The page composes the airspace between day cards, like
// the category stack does.
//
// Inside the card, meals are small eyebrow sub-headers with their foods
// indented under them - a second level the category tables do not have, so
// the rows keep their own indent instead of FLAT_TABLE_ROW's border
// separation. Every food line is a button opening the editor dialog: the
// plan is the app's one food editing surface.
//
// A meal with nothing in it is just empty, with no "Nothing planned"
// warning. The view works out what you carry and what it weighs; it does not
// check whether you have FINISHED planning.

// The plan tables' two value columns (day sections and the Not-scheduled
// section compose the same stubs, which is what keeps their rails aligned).
// Widths match the category tables' Qty / Weight rails so the two views scan
// the same, but these are this table's own columns and may diverge.
const FOOD_PLAN_COL_QTY = 'shrink-0 w-8 lg:w-10'
const FOOD_PLAN_COL_WEIGHT = 'shrink-0 w-20 lg:w-24'

/** The header's Qty / Weight label stubs. Same width tokens as the row
 *  cells below them, so the labels sit exactly over their columns. */
export function FoodPlanColumnLabels() {
  return (
    <>
      <div className={`${FOOD_PLAN_COL_QTY} text-center ${FLAT_TABLE_EYEBROW}`}>Qty</div>
      <div className={`${FOOD_PLAN_COL_WEIGHT} text-right ${FLAT_TABLE_EYEBROW}`}>Weight</div>
    </>
  )
}

type FoodPlanRowProps = {
  item: FoodItemResponse
  weightUnit: WeightUnit
  busy: boolean
  onEdit: (itemId: string) => void
  /** Day rows indent under their meal eyebrow; Not-scheduled rows sit flush. */
  indent: boolean
}

/** A food line in the plan: name, the one-container tag where it applies,
 *  then the Qty and Weight cells. The whole row is the edit affordance. */
export function FoodPlanRow({ item, weightUnit, busy, onEdit, indent }: FoodPlanRowProps) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onEdit(item.id)}
      aria-label={`Edit ${item.name}`}
      className={`flex w-full ${MOBILE_ROW_HEIGHT} ${DESKTOP_ROW_HEIGHT} items-center gap-2 py-1 lg:py-0.5 ${
        indent ? 'pl-7' : 'pl-3'
      } pr-3 text-left hover:bg-gray-50 disabled:opacity-50`}
    >
      <span
        className={`min-w-0 flex-1 ${FLAT_TABLE_BODY_TEXT} [overflow-wrap:anywhere] text-gray-900`}
      >
        {item.name}
      </span>
      {!item.isPerMeal && (
        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
          one container
        </span>
      )}
      <span className={`${FOOD_PLAN_COL_QTY} text-center ${FLAT_TABLE_QUANTITY_TEXT} text-gray-600`}>
        {item.quantity}
      </span>
      {/* The full stash weight at each occurrence (weight × this meal's
          count) - never multiplied by the schedule. */}
      <span className={`${FOOD_PLAN_COL_WEIGHT} text-right ${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}>
        <ItemWeightValue grams={item.weightGrams * item.quantity} unit={weightUnit} />
      </span>
    </button>
  )
}

type Props = {
  day: number
  slots: readonly FoodSlotResponse[]
  itemsBySlot: ReadonlyMap<string, FoodItemResponse[]>
  weightUnit: WeightUnit
  busy: boolean
  /** Opens the add dialog with these slots preselected: one slot from a meal
   *  line's "+ add", the whole day from an empty day's. */
  onAddToSlots: (slotIds: string[]) => void
  /** Opens the edit dialog for this item (any food line in the plan). */
  onEditItem: (itemId: string) => void
}

export default function FoodDaySection({
  day,
  slots,
  itemsBySlot,
  weightUnit,
  busy,
  onAddToSlots,
  onEditItem,
}: Props) {
  // The day total. The dedupe is conditional on the item's kind.
  //
  // A PER-MEAL item at both breakfast and lunch is two units: you eat one at
  // each, and the day weighs both. Deduping it would under-report, making a
  // five-lunch plan look like one packet.
  //
  // A SHARED stash at both meals is still ONE stash - a 500 g bag picked at
  // twice weighs 500 g for the day, not 1000. That case keeps the dedupe, and
  // it is the case the "scheduling never multiplies" contract was protecting.
  let dayGrams = 0
  const countedShared = new Set<string>()
  for (const slot of slots) {
    for (const item of itemsBySlot.get(slot.id) ?? []) {
      if (!item.isPerMeal) {
        if (countedShared.has(item.id)) continue
        countedShared.add(item.id)
      }
      dayGrams += item.weightGrams * item.quantity
    }
  }

  // A day with nothing planned collapses to a header-only card, with no meal
  // lines and no "total 0 g", so an unplanned trip is not a wall of
  // identical "+ Add" rows that drowns out the planned days. Its add
  // preselects the whole day; the dialog's grid is where the user narrows
  // that down. border-b-0 because the header is the card's only child, so
  // its divider would double with the card's own bottom border.
  if (slots.every((slot) => (itemsBySlot.get(slot.id) ?? []).length === 0)) {
    return (
      <section aria-label={`Day ${day}`} className={FLAT_TABLE_SURFACE}>
        <div className={`${FLAT_TABLE_HEADER} gap-2.5 ${FLAT_TABLE_HEADER_PADDING} border-b-0`}>
          <h3 className={FLAT_TABLE_HEADER_TITLE}>Day {day}</h3>
          <span className={`${FLAT_TABLE_META_TEXT} text-gray-500`}>Nothing planned</span>
          <button
            type="button"
            disabled={busy}
            aria-label={`Add food for day ${day}`}
            onClick={() => onAddToSlots(slots.map((slot) => slot.id))}
            className={`${FLAT_TABLE_META_TEXT} font-medium text-gray-500 hover:text-blue-600 disabled:opacity-50`}
          >
            + add
          </button>
        </div>
      </section>
    )
  }

  return (
    <section aria-label={`Day ${day}`} className={FLAT_TABLE_SURFACE}>
      {/* Header - also the Qty / Weight column header, like a category's. */}
      <div className={`${FLAT_TABLE_HEADER} gap-2 ${FLAT_TABLE_HEADER_PADDING}`}>
        <h3 className={`min-w-0 flex-1 truncate ${FLAT_TABLE_HEADER_TITLE}`}>Day {day}</h3>
        <FoodPlanColumnLabels />
      </div>
      <div className="pb-1.5">
        {slots.map((slot) => {
          const slotItems = itemsBySlot.get(slot.id) ?? []
          return (
            <div
              key={slot.id}
              role="group"
              aria-label={`${MEAL_LABELS[slot.meal]} day ${day}`}
              className="pt-1.5"
            >
              <div className="flex min-h-6 items-baseline gap-2 px-3">
                <span
                  // gray-500, not gray-400: 400 on white is ~2.5:1, under the
                  // 4.5:1 floor for text this small. 500 passes and still
                  // reads as muted beside the filled meals.
                  className={`${FLAT_TABLE_EYEBROW} ${slotItems.length === 0 ? 'text-gray-500' : ''}`}
                >
                  {MEAL_LABELS[slot.meal]}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Add food to day ${day} ${MEAL_LABELS[slot.meal].toLowerCase()}`}
                  onClick={() => onAddToSlots([slot.id])}
                  className={`${FLAT_TABLE_META_TEXT} font-medium text-gray-500 hover:text-blue-600 disabled:opacity-50`}
                >
                  + add
                </button>
                <span className="flex-1" aria-hidden="true" />
                {/* Only when two or more foods share the meal: a one-food
                    subtotal would repeat the number on the line below it.
                    Sits in the Weight column so it lines up with them. */}
                {slotItems.length > 1 && (
                  <span
                    className={`${FOOD_PLAN_COL_WEIGHT} text-right ${FLAT_TABLE_NUMERIC_TEXT} text-gray-500`}
                  >
                    <ItemWeightValue grams={foodGramsAtOneMeal(slotItems)} unit={weightUnit} />
                  </span>
                )}
              </div>
              {slotItems.map((item) => (
                <FoodPlanRow
                  key={item.id}
                  item={item}
                  weightUnit={weightUnit}
                  busy={busy}
                  onEdit={onEditItem}
                  indent
                />
              ))}
            </div>
          )
        })}
      </div>
      {/* Footer total under the Weight column, the shared footer recipe.
          Visible on every viewport, unlike a category's: mobile has no other
          surface carrying a per-day total. The day total is an AGGREGATE, so
          it renders through TotalWeightValue (compound lb+oz past 1 lb), not
          the rows' plain-ounce form. min-w instead of the rows' fixed
          FOOD_PLAN_COL_WEIGHT: the compound grid is wider than the column,
          and with the flex-1 spacer before it, min-w keeps the cell's right
          edge on the Weight rail (footer px-3 = row pr-3) while letting the
          lb part grow leftward. The compound grid's trailing oz cells match
          the rows' grid, so the oz digits stay on the rows' digit rail. */}
      <div className={`flex gap-2 ${FLAT_TABLE_FOOTER_ROW}`}>
        <span className="flex-1" aria-hidden="true" />
        <span className={FLAT_TABLE_FOOTER_LABEL}>Total</span>
        <span className={`shrink-0 min-w-20 lg:min-w-24 text-right ${FLAT_TABLE_FOOTER_VALUE}`}>
          <TotalWeightValue grams={dayGrams} unit={weightUnit} />
        </span>
      </div>
    </section>
  )
}
