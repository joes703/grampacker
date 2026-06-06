import { type FormEvent } from 'react'
import { Minus, Plus, Shirt, UtensilsCrossed, X } from 'lucide-react'
import FormLabel from '../components/FormLabel'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { ROW_CONTROL_TARGET } from '../components/flat-table-styles'
import WeightInput from '../components/WeightInput'
import { CONSUMABLE_ICON_CLASS, WORN_ICON_CLASS } from '../lib/row-indicator-styles'
import { useQuickAddForm, type AddItemData } from './use-quick-add-form'
import { MAX_LIST_ITEM_QUANTITY, MAX_NAME_LENGTH, MAX_DESC_LENGTH } from '../lib/queries/caps'

type Props = {
  onSubmit: (data: AddItemData) => void
  onClose: () => void
}

// Mobile presentation of the List Detail "Quick Add" flow. It uses the
// same hook, validation, and submit payload as the desktop inline
// AddItemRow; only the DOM differs, trading the cramped inline row for a
// roomy, touch-sized modal. Category is implicit: the caller
// (CategoryGroup) already knows which section's "Add item" button was
// tapped.
//
// Quick Add intentionally collects only the fields needed to put a new
// item on this list. Full inventory details like cost and purchase date
// live in GearItemDialog.
export default function QuickAddItemModal({ onSubmit, onClose }: Props) {
  const {
    name,
    setName,
    description,
    setDescription,
    weightGrams,
    setWeightGrams,
    quantity,
    setQuantity,
    worn,
    toggleWorn,
    consumable,
    toggleConsumable,
    canSubmit,
    buildData,
  } = useQuickAddForm()

  // Form submit (Save button or Enter in a text field). buildData() is the
  // single validation gate; it returns null on a blank name, which the
  // disabled Save button already prevents, so this is belt-and-braces.
  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const data = buildData()
    if (!data) return
    onSubmit(data)
  }

  const qtyNum = parseInt(quantity, 10) || 1

  return (
    <Modal
      open
      onClose={onClose}
      title="Quick add item"
      className="w-full max-w-md"
      closeOnBackdropClick={false}
    >
      <div className="p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Quick add item</h2>
          <button
            type="button"
            onClick={onClose}
            className={`${ROW_CONTROL_TARGET} text-gray-400 hover:text-gray-600`}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <FormLabel htmlFor="qa-name">
              Name
            </FormLabel>
            <input
              id="qa-name"
              type="text"
              required
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          <div>
            <FormLabel htmlFor="qa-desc">
              Description
            </FormLabel>
            <textarea
              id="qa-desc"
              maxLength={MAX_DESC_LENGTH}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-4">
            <div className="w-40">
              <FormLabel htmlFor="qa-weight">
                Weight
              </FormLabel>
              <WeightInput
                inputId="qa-weight"
                grams={weightGrams}
                onChange={setWeightGrams}
                className="w-full"
                inputClassName="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <FormLabel htmlFor="qa-qty">
                Quantity
              </FormLabel>
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantity(String(Math.max(1, qtyNum - 1)))}
                  disabled={qtyNum <= 1}
                  aria-label="Decrease quantity"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Minus size={16} />
                </button>
                <input
                  id="qa-qty"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_LIST_ITEM_QUANTITY}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="h-11 w-16 rounded-lg border border-gray-300 px-2 text-center text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setQuantity(String(Math.min(MAX_LIST_ITEM_QUANTITY, qtyNum + 1)))}
                  disabled={qtyNum >= MAX_LIST_ITEM_QUANTITY}
                  aria-label="Increase quantity"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex cursor-pointer select-none items-center gap-2">
              <input
                type="checkbox"
                checked={worn}
                onChange={toggleWorn}
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
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              <UtensilsCrossed size={14} className={CONSUMABLE_ICON_CLASS} />
              <span className="text-sm text-gray-700">Consumable (food, fuel, water)</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <PrimaryButton
              type="submit"
              disabled={!canSubmit}
            >
              Add item
            </PrimaryButton>
          </div>
        </form>
      </div>
    </Modal>
  )
}
