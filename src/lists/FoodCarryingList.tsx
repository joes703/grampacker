import { Fragment, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import {
  DESKTOP_ROW_HEIGHT,
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_NUMERIC_TEXT,
  MOBILE_ROW_HEIGHT,
  TABLE_DIVIDER,
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
  editingItemId,
  rescheduleEditor,
  onReschedule,
  onSetQuantity,
  onTogglePerMeal,
  onDelete,
}: {
  items: readonly FoodItemResponse[]
  weightUnit: WeightUnit
  busy: boolean
  /** The item whose slot picker is open, rendered as `rescheduleEditor`
   *  DIRECTLY under that item's row. Rendered at the list end instead, a
   *  long list put the editor below the fold of the rail's internal scroll
   *  area - invisible from the row that opened it. */
  editingItemId?: string | null
  rescheduleEditor?: ReactNode
  onReschedule: (itemId: string) => void
  onSetQuantity: (itemId: string, quantity: number) => void
  onTogglePerMeal: (itemId: string, isPerMeal: boolean) => void
  onDelete: (itemId: string) => void
}) {
  return (
    <>
      {items.map((item) => (
        <Fragment key={item.id}>
          <FoodItemRow
            item={item}
            weightUnit={weightUnit}
            busy={busy}
            onReschedule={() => onReschedule(item.id)}
            onSetQuantity={(quantity) => onSetQuantity(item.id, quantity)}
            onTogglePerMeal={() => onTogglePerMeal(item.id, !item.isPerMeal)}
            onDelete={() => onDelete(item.id)}
          />
          {item.id === editingItemId && rescheduleEditor}
        </Fragment>
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
  const mealsLabel = `${item.slotIds.length} ${item.slotIds.length === 1 ? 'meal' : 'meals'}`
  return (
    // Not FLAT_TABLE_ROW: this row is two stacked lines, so items-center
    // would fight the column layout. It keeps the height tokens so density
    // changes still reach it, and the taller content wins over both minima.
    <div
      className={`flex flex-col justify-center ${MOBILE_ROW_HEIGHT} ${DESKTOP_ROW_HEIGHT} border-b ${TABLE_DIVIDER} px-2 lg:px-3 py-2 lg:py-1`}
    >
      <span className="flex items-center gap-2">
        <span className={`min-w-0 flex-1 truncate ${FLAT_TABLE_BODY_TEXT}`}>{item.name}</span>
        {/* Numeric token, never bare - see FoodDaySection's weight comment.
            unitCount, not quantity: this column is what the item adds to the
            pack, which for a per-meal item is every meal it is in. */}
        <span className={`${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}>
          <ItemWeightValue grams={item.weightGrams * item.unitCount} unit={weightUnit} />
        </span>
        <RowIconButton
          touchSafe
          onClick={onDelete}
          disabled={busy}
          ariaLabel={`Remove ${item.name}`}
          title="Remove"
          icon={<Trash2 size={14} />}
        />
      </span>
      {/* The whole sentence: how many per meal, over how many meals, is how
          many you carry. It reads as the arithmetic it is, because the bug
          this replaces was the app doing NO arithmetic and leaving the user
          to notice. The mode word is the control that switches it, and the
          meals count is the control that opens the slot picker - the one
          bordered chip on the line, so the schedule affordance is visible
          without a separate wide "Reschedule" button crowding the row. */}
      <span
        className={`flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 ${FLAT_TABLE_META_TEXT} text-gray-600`}
      >
        <InlineQuantity
          quantity={item.quantity}
          max={FOOD_QUANTITY_MAX}
          onSave={busy ? undefined : onSetQuantity}
          itemName={item.name}
          // Resting state sizes to its content so the number sits flush in
          // the sentence; the editing input takes its own wider box (four
          // digits plus steppers). The commit does reflow the line for a
          // moment, which the old ONE-width rule avoided - but that rule
          // bought its stability with a permanently centered number
          // floating in input-sized whitespace, which read as a broken
          // layout on every row, every day.
          editingClassName="w-16 lg:w-12"
          align="start"
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
          className="shrink-0 rounded px-1 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
        >
          {item.isPerMeal ? 'per meal' : 'shared stash'}
        </button>
        <span aria-hidden="true" className="shrink-0">·</span>
        {item.slotIds.length === 0 && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
            Unscheduled
          </span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onReschedule}
          aria-label={`${item.slotIds.length > 0 ? 'Reschedule' : 'Schedule'} ${item.name}`}
          className="shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          {item.slotIds.length > 0 ? mealsLabel : 'Schedule'}
        </button>
        {/* Only when the two differ - repeating "= 1" on every shared row is
            noise, and the arithmetic is the point only where it happened. */}
        {item.unitCount !== item.quantity && (
          <span className="shrink-0 font-medium text-gray-700">
            = {item.unitCount} carried
          </span>
        )}
      </span>
    </div>
  )
}
