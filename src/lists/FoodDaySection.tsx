import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_QUANTITY_TEXT,
  FLAT_TABLE_ROW,
} from '../components/flat-table-styles'
import ItemWeightValue from '../components/ItemWeightValue'
import { foodGramsFor } from '../lib/weight-breakdown'
import { MEAL_LABELS } from './FoodSlotPicker'
import type { FoodItemResponse, FoodSlotResponse } from '../../shared/food'
import type { WeightUnit } from '../lib/weight'

// One day of the food grid: every meal slot for `day`, in MEALS order,
// showing the food scheduled at each and letting the user Skip a meal they
// will not eat or Restore one they skipped by mistake. Replaces the
// three-state grid from the retired inline food section that FoodView
// rendered before this redesign.
type Props = {
  day: number
  slots: readonly FoodSlotResponse[]
  itemsBySlot: ReadonlyMap<string, FoodItemResponse[]>
  weightUnit: WeightUnit
  busy: boolean
  onSetSlotNeeded: (slotId: string, needed: boolean) => void
  /** Opens the add form preselected to this slot. */
  onAddToSlot: (slotId: string) => void
}

export default function FoodDaySection({
  day,
  slots,
  itemsBySlot,
  weightUnit,
  busy,
  onSetSlotNeeded,
  onAddToSlot,
}: Props) {
  // Day total counts each distinct item ONCE even when it is scheduled at two
  // of this day's meals - summing per-slot repeats is the exact inflation
  // foodGramsFor's comment warns about (weight-breakdown.ts): a 500 g item
  // eaten at both breakfast and lunch must total 500 g for the day, not 1000.
  const dayItems = new Map<string, FoodItemResponse>()
  for (const slot of slots) {
    for (const item of itemsBySlot.get(slot.id) ?? []) dayItems.set(item.id, item)
  }
  const dayGrams = foodGramsFor([...dayItems.values()])

  return (
    <section aria-label={`Day ${day}`} className="border-t border-gray-100 first:border-t-0">
      <div className={`px-3 pt-2.5 pb-1 ${FLAT_TABLE_EYEBROW}`}>Day {day}</div>
      {slots.map((slot) => {
        const slotItems = itemsBySlot.get(slot.id) ?? []
        const slotGrams = foodGramsFor(slotItems)
        return (
          <div
            key={slot.id}
            // Padding is the canonical row inset horizontally; vertically a
            // documented variant (py-2 lg:py-1, not the token's lg:py-0)
            // because a slot stacks multiple food lines and items-start
            // content would sit flush against the row border without it.
            className={`${FLAT_TABLE_ROW} flex items-start gap-2 px-2 lg:px-3 py-2 lg:py-1 ${slot.needed ? '' : 'bg-gray-50'}`}
          >
            <span
              className={`w-20 shrink-0 pt-0.5 ${FLAT_TABLE_META_TEXT} ${
                slot.needed ? '' : 'line-through'
              }`}
            >
              {MEAL_LABELS[slot.meal]}
            </span>
            <span className="min-w-0 flex-1">
              {!slot.needed ? (
                <span className={FLAT_TABLE_META_TEXT}>Skipped</span>
              ) : slotItems.length === 0 ? (
                <span className="inline-flex items-center gap-2">
                  {/* The omission check. Reads as unfinished on purpose. */}
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                    Nothing planned
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAddToSlot(slot.id)}
                    className={`${FLAT_TABLE_BODY_TEXT} font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50`}
                  >
                    + Add
                  </button>
                </span>
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
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                // Skipping a FILLED slot unschedules its food. The items
                // survive and so does their weight - say so, because "Skip"
                // sounds like it should be reversible with nothing lost.
                if (slot.needed && slotItems.length > 0) {
                  const ok = window.confirm(
                    `${MEAL_LABELS[slot.meal]} on day ${day} has food planned for it. ` +
                      'Skipping it unschedules that food - it stays on the list and ' +
                      'still counts toward your pack weight. Continue?',
                  )
                  if (!ok) return
                }
                onSetSlotNeeded(slot.id, !slot.needed)
              }}
              className={`shrink-0 rounded px-2 py-1 ${FLAT_TABLE_META_TEXT} font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50`}
            >
              {slot.needed ? 'Skip' : 'Restore'}
            </button>
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
