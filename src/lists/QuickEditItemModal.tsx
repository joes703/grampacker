import { useState, type FormEvent } from 'react'
import { Minus, Plus, Shirt, UtensilsCrossed, X } from 'lucide-react'
import type { GearItem, ListItemWithGear } from '../lib/types'
import FormLabel from '../components/FormLabel'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { FORM_INPUT, ROW_CONTROL_TARGET, SECONDARY_BUTTON } from '../components/flat-table-styles'
import WeightInput from '../components/WeightInput'
import { CONSUMABLE_ICON_CLASS, WORN_ICON_CLASS } from '../lib/row-indicator-styles'
import { MAX_LIST_ITEM_QUANTITY, MAX_NAME_LENGTH } from '../lib/caps'
import { clampQuantity } from '../../shared/lists'
import { useWornConsumableFlags } from './use-worn-consumable-flags'

type QuickEditGearPatch = { name: string; weightGrams: number }
type QuickEditListPatch = {
  quantity: number
  isWorn: boolean
  isConsumable: boolean
}

type Props = {
  gear: GearItem
  /** null when the row has no list membership to edit (the caller then gets
   *  gear fields only). The list-view tap always has one. */
  listItem: ListItemWithGear | null
  saving: boolean
  saveError: string | null
  onClose: () => void
  onSave: (gearPatch: QuickEditGearPatch, listPatch: QuickEditListPatch | null) => void
  /** Switches to the full GearItemDialog (inventory fields, category,
   *  remove/delete paths). Receives the CURRENT drafts - the switch unmounts
   *  this form, and edits that silently vanish on the way to "more" would be
   *  worse than no shortcut. The name travels untrimmed so the full form
   *  shows exactly what was typed. */
  onMoreDetails: (
    gearDraft: { name: string; weightGrams: number },
    listDraft: QuickEditListPatch | null,
  ) => void
}

// The phone editor for a list row. The full inventory form (cost, purchase
// date, status, "Delete from inventory") is too much to change one weight.
// While planning a trip you touch name, weight,
// quantity and the two flags; everything else is inventory administration
// and sits behind "More details", which opens the full form.
//
// Same field conventions as QuickAddItemModal (the flag checkboxes, the
// quantity stepper, WeightInput). No initialFocus: unlike Quick Add, an
// edit has no single field the user always wants, and popping the keyboard
// over a tapped row would hide the values they came to check.
export default function QuickEditItemModal({
  gear,
  listItem,
  saving,
  saveError,
  onClose,
  onSave,
  onMoreDetails,
}: Props) {
  const [name, setName] = useState(gear.name)
  const [weightGrams, setWeightGrams] = useState(gear.weightGrams)
  const [quantity, setQuantity] = useState(String(listItem?.quantity ?? 1))
  const { worn, consumable, toggleWorn, toggleConsumable } = useWornConsumableFlags({
    isWorn: listItem?.isWorn ?? false,
    isConsumable: listItem?.isConsumable ?? false,
  })

  const qtyNum = clampQuantity(quantity)
  const canSubmit = name.trim().length > 0 && !saving

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    onSave(
      { name: trimmed, weightGrams },
      listItem
        ? {
            quantity: qtyNum,
            // The DB forbids worn+consumable together; the checkboxes below
            // clear each other, same as the row toggles and Quick Add.
            isWorn: worn,
            isConsumable: consumable,
          }
        : null,
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit item"
      className="w-full max-w-md"
      closeOnBackdropClick={false}
      preventDismiss={saving}
    >
      <div className="p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Edit item</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={`${ROW_CONTROL_TARGET} text-gray-500 hover:text-gray-600`}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <FormLabel htmlFor="qe-name">
              Name
            </FormLabel>
            <input
              id="qe-name"
              type="text"
              required
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              className={`w-full ${FORM_INPUT}`}
            />
          </div>

          <div className="flex gap-4">
            <div className="w-40">
              <FormLabel htmlFor="qe-weight">
                Weight
              </FormLabel>
              <WeightInput
                inputId="qe-weight"
                grams={weightGrams}
                onChange={setWeightGrams}
                className="w-full"
                inputClassName="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {listItem && (
              <div className="flex-1">
                <FormLabel htmlFor="qe-qty">
                  Quantity
                </FormLabel>
                <div className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQuantity(String(Math.max(1, qtyNum - 1)))}
                    disabled={saving || qtyNum <= 1}
                    aria-label="Decrease quantity"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Minus size={16} />
                  </button>
                  <input
                    id="qe-qty"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_LIST_ITEM_QUANTITY}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    disabled={saving}
                    className="h-11 w-16 rounded-lg border border-gray-300 px-2 text-center text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setQuantity(String(Math.min(MAX_LIST_ITEM_QUANTITY, qtyNum + 1)))}
                    disabled={saving || qtyNum >= MAX_LIST_ITEM_QUANTITY}
                    aria-label="Increase quantity"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {listItem && (
            <div className="space-y-2">
              <label className="flex cursor-pointer select-none items-center gap-2">
                <input
                  type="checkbox"
                  checked={worn}
                  onChange={toggleWorn}
                  disabled={saving}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                />
                <Shirt size={14} className={WORN_ICON_CLASS} />
                <span className="text-sm text-gray-700">Worn (not added to pack weight)</span>
              </label>
              <label className="flex cursor-pointer select-none items-center gap-2">
                <input
                  type="checkbox"
                  checked={consumable}
                  onChange={toggleConsumable}
                  disabled={saving}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                />
                <UtensilsCrossed size={14} className={CONSUMABLE_ICON_CLASS} />
                <span className="text-sm text-gray-700">Consumable (food, fuel, water)</span>
              </label>
            </div>
          )}

          {/* A failure the user cannot see is not reported: the modal hosts
              the toast region while open, but its own save reports inline,
              beside the form (the modal rule in mutation-error-handler). */}
          {saveError && (
            <p role="alert" className="text-sm text-red-600">{saveError}</p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() =>
                onMoreDetails(
                  { name, weightGrams },
                  listItem
                    ? {
                        quantity: qtyNum,
                        isWorn: worn,
                        isConsumable: consumable,
                      }
                    : null,
                )
              }
              disabled={saving}
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              More details
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className={SECONDARY_BUTTON}
            >
              Cancel
            </button>
            <PrimaryButton type="submit" disabled={!canSubmit}>
              {saving ? 'Saving…' : 'Save'}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </Modal>
  )
}
