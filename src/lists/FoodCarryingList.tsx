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
  onTogglePerMeal,
  onDelete,
}: {
  items: readonly FoodItemResponse[]
  weightUnit: WeightUnit
  busy: boolean
  onReschedule: (itemId: string) => void
  onSetQuantity: (itemId: string, quantity: number) => void
  onTogglePerMeal: (itemId: string, isPerMeal: boolean) => void
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
          onTogglePerMeal={() => onTogglePerMeal(item.id, !item.isPerMeal)}
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
  onTogglePerMeal,
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
  /** Switches this item between "one (or `quantity`) for each meal it is
   *  scheduled into" and "one shared stash, however many meals it spans". */
  onTogglePerMeal: () => void
  onDelete: () => void
}) {
  return (
    // Vertical padding is a documented variant (py-2 lg:py-1, not the row
    // token's lg:py-0): the row stacks a name line over a meta line, so
    // desktop needs real breathing room above min-h.
    <div className={`${FLAT_TABLE_ROW} flex items-center gap-2 px-2 lg:px-3 py-2 lg:py-1`}>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${FLAT_TABLE_BODY_TEXT}`}>{item.name}</span>
        {/* The whole sentence: how many per meal, over how many meals, is how
            many you carry. It reads as the arithmetic it is, because the bug
            this replaces was the app doing NO arithmetic and leaving the user
            to notice. The mode word is the control that switches it. */}
        <span className={`flex min-w-0 flex-wrap items-center gap-x-1 ${FLAT_TABLE_META_TEXT}`}>
          <InlineQuantity
            quantity={item.quantity}
            max={FOOD_QUANTITY_MAX}
            onSave={busy ? undefined : onSetQuantity}
            itemName={item.name}
            // ONE width for every state, sized for the WIDEST of them: the
            // number input, which has to hold four digits plus its padding,
            // border and the browser's native steppers. Sizing to the resting
            // label instead fits the label fine and clips the input, and any
            // difference between the two reflows the line on every commit.
            className="w-16 lg:w-12"
            align="center"
          />
          <button
            type="button"
            disabled={busy}
            onClick={onTogglePerMeal}
            title={
              item.isPerMeal
                ? 'Counted for each meal. Switch to one shared stash.'
                : 'One shared stash. Switch to one for each meal.'
            }
            aria-label={`${item.name} is ${item.isPerMeal ? 'per meal' : 'shared'}. Switch.`}
            className="shrink-0 rounded px-1 underline decoration-dotted underline-offset-2 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
          >
            {item.isPerMeal ? 'per meal' : 'shared'}
          </button>
          <span aria-hidden="true" className="shrink-0">·</span>
          {item.slotIds.length > 0 ? (
            `${item.slotIds.length} ${item.slotIds.length === 1 ? 'meal' : 'meals'}`
          ) : (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              Unscheduled
            </span>
          )}
          {/* Only when the two differ - repeating "= 1" on every shared row is
              noise, and the arithmetic is the point only where it happened. */}
          {item.unitCount !== item.quantity && (
            <span className="shrink-0 font-medium text-gray-700">
              = {item.unitCount}
            </span>
          )}
        </span>
      </span>
      {/* Numeric token, never bare - see FoodDaySection's weight comment.
          unitCount, not quantity: this column is what the item adds to the
          pack, which for a per-meal item is every meal it is in. */}
      <span className={`${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}>
        <ItemWeightValue grams={item.weightGrams * item.unitCount} unit={weightUnit} />
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
