import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_QUANTITY_TEXT,
  FLAT_TABLE_ROW,
} from '../components/flat-table-styles'
import ItemWeightValue from '../components/ItemWeightValue'
import { foodGramsAtOneMeal } from '../lib/weight-breakdown'
import { MEAL_LABELS } from './FoodSlotPicker'
import type { FoodItemResponse, FoodSlotResponse } from '../../shared/food'
import type { WeightUnit } from '../lib/weight'

// One day of the food grid: every meal slot for `day`, in MEALS order, showing
// the food scheduled at each.
//
// A meal with nothing in it is just empty. It used to carry a "Nothing
// planned" warning and a Skip button whose only job was to silence that
// warning, which made the view an audit of whether you had FINISHED planning -
// a different job from working out what you carry and what it weighs, and the
// last of the deleted meal planner still standing here.
type Props = {
  day: number
  slots: readonly FoodSlotResponse[]
  itemsBySlot: ReadonlyMap<string, FoodItemResponse[]>
  weightUnit: WeightUnit
  busy: boolean
  /** Opens the add form preselected to this slot. */
  onAddToSlot: (slotId: string) => void
}

export default function FoodDaySection({
  day,
  slots,
  itemsBySlot,
  weightUnit,
  busy,
  onAddToSlot,
}: Props) {
  // The day total, and the dedupe is now conditional - 0024 split the two
  // cases that used to be one.
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

  return (
    <section aria-label={`Day ${day}`} className="border-t border-gray-100 first:border-t-0">
      <div className={`px-3 pt-2.5 pb-1 ${FLAT_TABLE_EYEBROW}`}>Day {day}</div>
      {slots.map((slot) => {
        const slotItems = itemsBySlot.get(slot.id) ?? []
        const slotGrams = foodGramsAtOneMeal(slotItems)
        return (
          <div
            key={slot.id}
            // Padding is the canonical row inset horizontally; vertically a
            // documented variant (py-2 lg:py-1, not the token's lg:py-0)
            // because a slot stacks multiple food lines and items-start
            // content would sit flush against the row border without it.
            className={`${FLAT_TABLE_ROW} flex items-start gap-2 px-2 lg:px-3 py-2 lg:py-1`}
          >
            <span className={`w-20 shrink-0 pt-0.5 ${FLAT_TABLE_META_TEXT}`}>
              {MEAL_LABELS[slot.meal]}
            </span>
            <span className="min-w-0 flex-1">
              {slotItems.length === 0 ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAddToSlot(slot.id)}
                  className={`${FLAT_TABLE_BODY_TEXT} font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50`}
                >
                  + Add
                </button>
              ) : (
                <span className="flex flex-col gap-0.5">
                  {slotItems.map((item) => (
                    <span key={item.id} className="flex items-baseline gap-2">
                      <span className={`min-w-0 flex-1 truncate ${FLAT_TABLE_BODY_TEXT}`}>
                        {item.name}
                      </span>
                      {item.quantity > 1 && (
                        <span className={FLAT_TABLE_QUANTITY_TEXT}>× {item.quantity}</span>
                      )}
                      {/* Weight values always ride the numeric token -
                          ItemWeightValue inherits its font, and bare it
                          renders at the 16px page default (mono + tabular is
                          also what makes its ch-grid columns line up). */}
                      <span className={`${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}>
                        <ItemWeightValue grams={item.weightGrams * item.quantity} unit={weightUnit} />
                      </span>
                    </span>
                  ))}
                  {slotItems.length > 1 && (
                    <span
                      className={`flex justify-end border-t border-gray-100 pt-0.5 ${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}
                    >
                      <ItemWeightValue grams={slotGrams} unit={weightUnit} />
                    </span>
                  )}
                </span>
              )}
            </span>
          </div>
        )
      })}
      <div className={`flex items-baseline justify-end gap-2 px-3 pb-2 ${FLAT_TABLE_META_TEXT}`}>
        <span>Day total</span>
        <span className={`${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}>
          <ItemWeightValue grams={dayGrams} unit={weightUnit} />
        </span>
      </div>
    </section>
  )
}
