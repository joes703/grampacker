import { Trash2 } from 'lucide-react'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_ROW,
} from '../components/flat-table-styles'
import ItemWeightValue from '../components/ItemWeightValue'
import InlineQuantity from '../components/InlineQuantity'
import RowIconButton from '../components/RowIconButton'
import { foodGramsFor } from '../lib/weight-breakdown'
import { FOOD_QUANTITY_MAX, type FoodItemResponse } from '../../shared/food'
import type { WeightUnit } from '../lib/weight'

// The single carrying list for the Food view: every carried item, scheduled
// or not, in one list. Replaces the retired inline food section's old split
// into a "Carrying" section and a duplicate "Unscheduled" section - an item
// was never in both, so the split bought nothing but a second heading. An
// unscheduled item is marked inline with a badge instead of a "Any time"
// text that read as if it were a real schedule choice.
export default function FoodCarryingList({
  items,
  weightUnit,
  busy,
  onReschedule,
  onSetQuantity,
  onDelete,
}: {
  items: readonly FoodItemResponse[]
  weightUnit: WeightUnit
  busy: boolean
  onReschedule: (itemId: string) => void
  onSetQuantity: (itemId: string, quantity: number) => void
  onDelete: (itemId: string) => void
}) {
  return (
    <>
      {items.map((item) => (
        <FoodItemRow
          key={item.id}
          item={item}
          weightUnit={weightUnit}
          busy={busy}
          onReschedule={() => onReschedule(item.id)}
          onSetQuantity={(quantity) => onSetQuantity(item.id, quantity)}
          onDelete={() => onDelete(item.id)}
        />
      ))}
      <div
        className={`flex items-baseline justify-end gap-2 border-t border-gray-100 px-3 py-2 ${FLAT_TABLE_META_TEXT}`}
      >
        <span>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
        {/* foodGramsFor sums items alone - never joined through slots, or a
            food eaten at several meals would count its weight once per meal. */}
        <span className={`${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}>
          <ItemWeightValue grams={foodGramsFor(items)} unit={weightUnit} />
        </span>
      </div>
    </>
  )
}

function FoodItemRow({
  item,
  weightUnit,
  busy,
  onReschedule,
  onSetQuantity,
  onDelete,
}: {
  item: FoodItemResponse
  weightUnit: WeightUnit
  busy: boolean
  /** Opens the slot picker for this item. Present on every row regardless of
   *  scheduled state: an item that lost its meals - because the slot was
   *  pruned or the trip was shortened - has to be repairable without
   *  deleting and retyping it. */
  onReschedule: () => void
  /** How many UNITS of this you carry. Scheduling says when you eat it and
   *  never multiplies the weight (one bag across five lunches is one bag), so
   *  this is the only place a per-meal item's count can come from. It was
   *  settable on the add form and nowhere else, which left every item stuck at
   *  1 and under-reported the pack. */
  onSetQuantity: (quantity: number) => void
  onDelete: () => void
}) {
  return (
    // Vertical padding is a documented variant (py-2 lg:py-1, not the row
    // token's lg:py-0): the row stacks a name line over a meta line, so
    // desktop needs real breathing room above min-h.
    <div className={`${FLAT_TABLE_ROW} flex items-center gap-2 px-2 lg:px-3 py-2 lg:py-1`}>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${FLAT_TABLE_BODY_TEXT}`}>{item.name}</span>
        {/* "Carry N" then the schedule, deliberately NOT "N x 5 meals": the
            x reads as a multiplication that does not happen. Scheduling says
            WHEN you eat this, the count says how many you pack, and the two
            are independent - conflating them is what made a five-lunch plan
            look like it weighed one packet. */}
        <span className={`flex min-w-0 flex-wrap items-center gap-x-1 ${FLAT_TABLE_META_TEXT}`}>
          <span className="shrink-0">Carry</span>
          <InlineQuantity
            quantity={item.quantity}
            max={FOOD_QUANTITY_MAX}
            onSave={busy ? undefined : onSetQuantity}
            itemName={item.name}
            // ONE width for every state, sized for the WIDEST of them: the
            // number input, which has to hold four digits plus its padding,
            // border and the browser's native steppers. Sizing to the resting
            // label instead (w-12/lg:w-10) fits the label fine and clips the
            // input, and any difference between the two reflows the line on
            // every commit.
            className="w-16 lg:w-12"
            align="center"
          />
          <span aria-hidden="true" className="shrink-0">·</span>
          {item.slotIds.length > 0 ? (
            `${item.slotIds.length} ${item.slotIds.length === 1 ? 'meal' : 'meals'}`
          ) : (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              Unscheduled
            </span>
          )}
        </span>
      </span>
      {/* Numeric token, never bare - see FoodDaySection's weight comment. */}
      <span className={`${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}>
        <ItemWeightValue grams={item.weightGrams * item.quantity} unit={weightUnit} />
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={onReschedule}
        className={`shrink-0 rounded px-2 py-1 ${FLAT_TABLE_META_TEXT} font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50`}
      >
        {item.slotIds.length > 0 ? 'Reschedule' : 'Schedule'}
      </button>
      <RowIconButton
        touchSafe
        onClick={onDelete}
        disabled={busy}
        ariaLabel={`Remove ${item.name}`}
        title="Remove"
        icon={<Trash2 size={14} />}
      />
    </div>
  )
}
