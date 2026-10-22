import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_QUANTITY_TEXT,
} from '../components/flat-table-styles'
import ItemWeightValue from '../components/ItemWeightValue'
import { foodGramsAtOneMeal } from '../lib/weight-breakdown'
import { MEAL_LABELS } from './FoodMealGrid'
import type { FoodItemResponse, FoodSlotResponse } from '../../shared/food'
import type { WeightUnit } from '../lib/weight'

// One day of the meal plan: a day band (name + total), then each meal as a
// small header line with its foods indented under it. Every food line is a
// button opening the editor dialog - the plan is the app's one food editing
// surface; the shopping list beside it is a read-only tally.
//
// A meal with nothing in it is just empty. It used to carry a "Nothing
// planned" warning and a Skip button whose only job was to silence that
// warning, which made the view an audit of whether you had FINISHED planning -
// a different job from working out what you carry and what it weighs.
type Props = {
  day: number
  slots: readonly FoodSlotResponse[]
  itemsBySlot: ReadonlyMap<string, FoodItemResponse[]>
  weightUnit: WeightUnit
  busy: boolean
  /** Opens the add dialog with these slots preselected: one slot from a meal
   *  line's "+ add", the whole day from a collapsed day's. */
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
  // The day total, and the dedupe is conditional - 0024 split the two cases
  // that used to be one.
  //
  // A PER-MEAL item at both breakfast and lunch is two units: you eat one at
  // each, and the day weighs both. Deduping it (which this did, for every
  // item) is precisely the under-report that made a five-lunch plan look like
  // one packet.
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

  // A day with nothing planned collapses to one quiet line, with no meal
  // lines and no "total 0 g": an unplanned trip used to be a wall of
  // identical "+ Add" rows that drowned out the planned days. Its add
  // preselects the whole day; the dialog's grid is where the user narrows
  // that down.
  if (slots.every((slot) => (itemsBySlot.get(slot.id) ?? []).length === 0)) {
    return (
      <section aria-label={`Day ${day}`} className="border-t border-gray-100 first:border-t-0">
        <div className="flex items-baseline gap-2.5 px-3 py-2">
          <span className={FLAT_TABLE_EYEBROW}>Day {day}</span>
          {/* gray-500, not gray-400: 400 on white is ~2.5:1, under the
              4.5:1 floor for text this small. 500 passes and still reads
              as muted beside the filled days. Same below. */}
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
    <section aria-label={`Day ${day}`} className="border-t border-gray-100 first:border-t-0">
      {/* The day band: a stronger strip than the meal lines inside it, so a
          long trip scans day by day. gray-100 on purpose, one step past the
          gray-50 header token - the meal eyebrows inside provide the second
          tier, and two gray-50 strips four lines apart read as one. */}
      <div className="flex items-baseline justify-between gap-3 bg-gray-100 px-3 py-1.5">
        <h3 className="text-sm font-semibold text-gray-900">Day {day}</h3>
        <span className={`flex items-baseline gap-1.5 ${FLAT_TABLE_META_TEXT} text-gray-500`}>
          <span>total</span>
          <span className={`${FLAT_TABLE_NUMERIC_TEXT} font-semibold text-gray-700`}>
            <ItemWeightValue grams={dayGrams} unit={weightUnit} />
          </span>
        </span>
      </div>
      <div className="pb-2">
        {slots.map((slot) => {
          const slotItems = itemsBySlot.get(slot.id) ?? []
          return (
            <div
              key={slot.id}
              role="group"
              aria-label={`${MEAL_LABELS[slot.meal]} day ${day}`}
              className="pt-1.5"
            >
              <div className="flex min-h-6 items-baseline gap-2.5 px-3">
                <span
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
                    subtotal would repeat the number on the line below it. */}
                {slotItems.length > 1 && (
                  <span className={`${FLAT_TABLE_NUMERIC_TEXT} shrink-0 text-gray-500`}>
                    <ItemWeightValue grams={foodGramsAtOneMeal(slotItems)} unit={weightUnit} />
                  </span>
                )}
              </div>
              {slotItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onEditItem(item.id)}
                  aria-label={`Edit ${item.name}`}
                  className="flex w-full min-h-11 lg:min-h-7 items-center gap-2 py-1 lg:py-0.5 pl-7 pr-3 text-left hover:bg-gray-50 disabled:opacity-50"
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
                  {item.quantity > 1 && (
                    <span className={`shrink-0 ${FLAT_TABLE_QUANTITY_TEXT} text-gray-600`}>
                      × {item.quantity}
                    </span>
                  )}
                  {/* The full stash weight at each occurrence (weight × this
                      meal's count) - never multiplied by the schedule. The
                      numeric token keeps the fixed right column aligned. */}
                  <span className={`${FLAT_TABLE_NUMERIC_TEXT} w-16 shrink-0 text-right text-gray-600`}>
                    <ItemWeightValue grams={item.weightGrams * item.quantity} unit={weightUnit} />
                  </span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}
