import { Trash2 } from 'lucide-react'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_ROW,
} from '../components/flat-table-styles'
import ItemWeightValue from '../components/ItemWeightValue'
import RowIconButton from '../components/RowIconButton'
import { foodGramsFor } from '../lib/weight-breakdown'
import type { FoodItemResponse } from '../../shared/food'
import type { WeightUnit } from '../lib/weight'

// The single carrying list for the Food view: every carried item, scheduled
// or not, in one list. Replaces FoodSection's old split into a "Carrying"
// section and a duplicate "Unscheduled" section - an item was never in both,
// so the split bought nothing but a second heading. An unscheduled item is
// marked inline with a badge instead of a "Any time" text that read as if
// it were a real schedule choice.
export default function FoodCarryingList({
  items,
  weightUnit,
  busy,
  onReschedule,
  onDelete,
}: {
  items: readonly FoodItemResponse[]
  weightUnit: WeightUnit
  busy: boolean
  onReschedule: (itemId: string) => void
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
          onDelete={() => onDelete(item.id)}
        />
      ))}
      <div
        className={`flex items-center justify-end gap-2 border-t border-gray-100 px-3 py-2 ${FLAT_TABLE_META_TEXT}`}
      >
        <span>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
        {/* foodGramsFor sums items alone - never joined through slots, or a
            food eaten at several meals would count its weight once per meal. */}
        <ItemWeightValue grams={foodGramsFor(items)} unit={weightUnit} />
      </div>
      {/* The app already labels gear consumables "food, fuel, water". Anyone
          keeping a "Food bag" gear row AND listing its contents here would
          count the same grams twice. */}
      <p className="px-3 pb-2 text-xs text-gray-500">
        Adds to your consumable weight. If you also have a food item in your
        gear list, remove it so it is not counted twice.
      </p>
    </>
  )
}

function FoodItemRow({
  item,
  weightUnit,
  busy,
  onReschedule,
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
  onDelete: () => void
}) {
  return (
    <div className={`${FLAT_TABLE_ROW} flex items-center gap-2`}>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${FLAT_TABLE_BODY_TEXT}`}>{item.name}</span>
        <span className={`block ${FLAT_TABLE_META_TEXT}`}>
          {item.quantity > 1 ? `${item.quantity} × ` : ''}
          {item.slotIds.length > 0 ? (
            `${item.slotIds.length} ${item.slotIds.length === 1 ? 'meal' : 'meals'}`
          ) : (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              Unscheduled
            </span>
          )}
        </span>
      </span>
      <ItemWeightValue grams={item.weightGrams * item.quantity} unit={weightUnit} />
      <button
        type="button"
        disabled={busy}
        onClick={onReschedule}
        className="shrink-0 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
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
