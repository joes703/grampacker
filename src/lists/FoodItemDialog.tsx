import { useState, type FormEvent, type RefObject } from 'react'
import { X } from 'lucide-react'
import Modal from '../components/Modal'
import FormLabel from '../components/FormLabel'
import PrimaryButton from '../components/PrimaryButton'
import WeightInput from '../components/WeightInput'
import {
  FORM_INPUT,
  ROW_CONTROL_TARGET,
  SECONDARY_BUTTON,
} from '../components/flat-table-styles'
import FoodMealGrid, { MEAL_LABELS } from './FoodMealGrid'
import { foodItemPatch, foodItemSummary, type FoodItemDraft } from './food-item-form'
import {
  FOOD_QUANTITY_MAX,
  type CreateFoodItemRequest,
  type FoodItemResponse,
  type FoodSlotResponse,
  type UpdateFoodItemRequest,
} from '../../shared/food'
import type { WeightUnit } from '../lib/weight'

export type FoodItemDialogMode =
  | { kind: 'add'; initialSlotIds: readonly string[] }
  | { kind: 'edit'; item: FoodItemResponse }

type Props = {
  mode: FoodItemDialogMode
  slots: readonly FoodSlotResponse[]
  weightUnit: WeightUnit
  busy: boolean
  /** The parent's mutation onError routes failure copy here while the dialog
   *  is on screen (src/lib/report-failure.ts picks inline vs toast); rendered
   *  as an inline alert so the draft and a retry stay together. */
  saveError: string | null
  /** An always-rendered element inside the dialog for that routing decision. */
  anchorRef?: RefObject<HTMLParagraphElement | null>
  onClose: () => void
  onCreate: (input: CreateFoodItemRequest) => void
  /** Edit submit, called with the CHANGED fields only - never an empty patch
   *  (an unchanged draft just closes). */
  onSave: (itemId: string, patch: UpdateFoodItemRequest) => void
  onDelete: (itemId: string) => void
}

// The one food editor: adding from the header or a meal's "+ add", and
// editing anything about an existing item (tap its row in the plan). This
// dialog and the plan ARE the one editing surface for food.
//
// Call sites must key this component per open (and per item), like
// GearItemDialog: the draft and the diff baseline are captured by useState
// initializers, so a reused instance would keep the previous item's draft.
export default function FoodItemDialog({
  mode,
  slots,
  weightUnit,
  busy,
  saveError,
  anchorRef,
  onClose,
  onCreate,
  onSave,
  onDelete,
}: Props) {
  const item = mode.kind === 'edit' ? mode.item : null
  const [name, setName] = useState(item?.name ?? '')
  const [weightGrams, setWeightGrams] = useState(item?.weightGrams ?? 0)
  // String so the user can clear and retype without React fighting the cursor.
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1))
  const [oneContainer, setOneContainer] = useState(item ? !item.isPerMeal : false)
  const [selected, setSelected] = useState<string[]>(
    item ? [...item.slotIds] : [...(mode.kind === 'add' ? mode.initialSlotIds : [])],
  )
  // The item as this dialog OPENED. The submit diffs the draft against THIS,
  // not against mode.item, which a background refetch can replace mid-edit -
  // diffing against the fresher copy would write stale draft values over
  // fields the user never touched (see foodItemPatch).
  const [baseline] = useState<FoodItemDraft | null>(() =>
    item
      ? {
          name: item.name,
          weightGrams: item.weightGrams,
          quantity: item.quantity,
          isPerMeal: item.isPerMeal,
          slotIds: [...item.slotIds],
        }
      : null,
  )

  // Selection is filtered against the LIVE slots every render, not once at
  // mount: a focus refetch can trim the trip while the dialog is open, and a
  // trimmed id must never reach the grid, the summary, or a write. State may
  // go stale harmlessly; what renders and submits cannot.
  const liveIds = new Set(slots.map((slot) => slot.id))
  const effectiveSelected = selected.filter((id) => liveIds.has(id))

  const quantityValue = Number(quantity)
  // Mirrors the server bounds (shared/food.ts) so a rejection is not the
  // first the user hears of them. Weight needs no bound here: WeightInput
  // clamps to MAX_ITEM_WEIGHT_GRAMS, which equals foodWeightSchema's max
  // (pinned by FoodItemDialog.test.tsx).
  //
  // Quantity validity stands on its own: the summary reads it, and judging
  // it by whole-form validity made clearing the NAME change the carried
  // count mid-rename.
  const quantityValid =
    Number.isInteger(quantityValue) &&
    quantityValue >= 1 &&
    quantityValue <= FOOD_QUANTITY_MAX
  const valid =
    name.trim().length > 0 && name.trim().length <= 128 && quantityValid

  const draft: FoodItemDraft = {
    name,
    weightGrams,
    quantity: quantityValid ? quantityValue : 1,
    isPerMeal: !oneContainer,
    slotIds: effectiveSelected,
  }
  const summary = foodItemSummary(draft, weightUnit)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    if (mode.kind === 'add') {
      onCreate({
        name: name.trim(),
        weightGrams,
        quantity: quantityValue,
        isPerMeal: !oneContainer,
        slotIds: effectiveSelected,
      })
      return
    }
    if (!baseline) return
    // The baseline's slots go through the same live filter, so a pruning that
    // happened while the dialog was open never reads as a user edit.
    const patch = foodItemPatch(
      { ...baseline, slotIds: baseline.slotIds.filter((id) => liveIds.has(id)) },
      { ...draft, name: name.trim(), quantity: quantityValue },
    )
    if (!patch) {
      onClose()
      return
    }
    onSave(mode.item.id, patch)
  }

  const title = mode.kind === 'add' ? 'Add food' : `Edit ${baseline?.name ?? ''}`
  const subtitle = mode.kind === 'add' ? startedFrom(mode.initialSlotIds, slots) : null

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-hidden"
      // No preventDismiss: a hung request must not wall the user in (the
      // "never gate the way out" rule). Escape, Close and Cancel stay live
      // during a save; a failure that lands after dismissal still reaches
      // the user through the caller's reportFailure toast fallback.
      closeOnBackdropClick={false}
    >
      <form onSubmit={handleSubmit} className="flex max-h-[90vh] min-h-0 flex-col">
        <div className="flex items-start justify-between gap-2 px-6 pt-5 pb-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`${ROW_CONTROL_TARGET} shrink-0 text-gray-500 hover:text-gray-600`}
          >
            <X size={18} />
          </button>
        </div>

        {/* The fieldset freezes the FIELDS during a save so a success cannot
            close over input the submitted payload never saw; min-w-0 undoes
            the UA min-inline-size floor (see GearItemDialog). Deliberately
            scoped to the body: Close and Cancel stay reachable, because
            abandoning a slow save is a legitimate thing to want. */}
        <fieldset
          disabled={busy}
          className="flex-1 min-h-0 min-w-0 overflow-y-auto px-6 space-y-4 disabled:opacity-60"
        >
          <div>
            <FormLabel htmlFor="fi-name">Name</FormLabel>
            <input
              id="fi-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
              className={`w-full ${FORM_INPUT}`}
            />
          </div>

          <div className="flex gap-4">
            <div>
              <FormLabel htmlFor="fi-weight">Weight (one item)</FormLabel>
              <WeightInput
                inputId="fi-weight"
                grams={weightGrams}
                onChange={setWeightGrams}
                className="w-36"
                inputClassName={`w-full min-w-0 ${FORM_INPUT} text-right tabular-nums`}
              />
            </div>
            <div>
              <FormLabel htmlFor="fi-qty">How many</FormLabel>
              <div className="flex items-center gap-2">
                <input
                  id="fi-qty"
                  type="number"
                  min={1}
                  max={FOOD_QUANTITY_MAX}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className={`w-20 ${FORM_INPUT} text-right tabular-nums`}
                />
                <span className="text-sm text-gray-500">
                  {oneContainer ? 'total' : 'per meal'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <input
              id="fi-one-container"
              type="checkbox"
              checked={oneContainer}
              onChange={(e) => setOneContainer(e.target.checked)}
              aria-describedby="fi-one-container-help"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            <span className="text-sm text-gray-700">
              <label htmlFor="fi-one-container" className="cursor-pointer select-none">
                One container for the whole trip
              </label>
              <span id="fi-one-container-help" className="block text-xs text-gray-500">
                Count its weight once, however many meals it's in — like one jar of
                peanut butter.
              </span>
            </span>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-gray-700">Which meals?</p>
            {slots.length === 0 ? (
              <p className="text-sm text-gray-500">
                Set a trip length and the meals appear here.
              </p>
            ) : (
              <FoodMealGrid
                slots={slots}
                selected={effectiveSelected}
                onChange={setSelected}
              />
            )}
          </div>

          {/* Always rendered (reportFailure's anchor), so an out-of-range
              count swaps the text rather than removing the element. */}
          <p ref={anchorRef} className="text-sm text-gray-700">
            {quantityValid ? (
              <>
                You'll carry{' '}
                <strong className="font-semibold text-gray-900">{summary.unitCount}</strong>
                {summary.weightLabel && (
                  <>
                    {' · '}
                    <span className="font-mono font-semibold tabular-nums text-gray-900">
                      {summary.weightLabel}
                    </span>
                  </>
                )}{' '}
                <span className="text-gray-500">— {summary.note}</span>
              </>
            ) : (
              <span className="text-gray-500">
                Enter how many (1–{FOOD_QUANTITY_MAX}) to see what you'll carry.
              </span>
            )}
          </p>

          {saveError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {saveError}
            </div>
          )}

          <div className="h-2" aria-hidden="true" />
        </fieldset>

        <div
          className="shrink-0 border-t border-gray-100 bg-white px-6 py-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center gap-2">
            <PrimaryButton type="submit" disabled={busy || !valid}>
              {busy ? 'Saving…' : mode.kind === 'add' ? 'Add food' : 'Save'}
            </PrimaryButton>
            <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
              Cancel
            </button>
            {mode.kind === 'edit' && (
              <>
                <span className="flex-1" aria-hidden="true" />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDelete(mode.item.id)}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Remove from plan
                </button>
              </>
            )}
          </div>
        </div>
      </form>
    </Modal>
  )
}

// "Started from Day 2 lunch" under the Add title, so pre-checked boxes read
// as the gesture that opened the dialog rather than a surprise. Only the two
// real gestures are named (one meal's "+ add"; a collapsed day's whole-day
// add); anything else gets no subtitle.
function startedFrom(
  slotIds: readonly string[],
  slots: readonly FoodSlotResponse[],
): string | null {
  if (slotIds.length === 0) return null
  const picked = new Set(slotIds)
  const named = slots.filter((slot) => picked.has(slot.id))
  const [first] = named
  if (!first) return null
  if (named.length === 1) {
    return `Started from Day ${first.dayNumber} ${MEAL_LABELS[first.meal].toLowerCase()} — adjust the meals below.`
  }
  if (named.every((slot) => slot.dayNumber === first.dayNumber)) {
    return `Started from Day ${first.dayNumber} — adjust the meals below.`
  }
  return null
}
