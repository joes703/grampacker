import { useState } from 'react'
import WeightInput from '../components/WeightInput'
import FoodSlotPicker from './FoodSlotPicker'
import { addFoodPreview } from './add-food-preview'
import type { FoodSlotResponse } from '../../shared/food'
import type { WeightUnit } from '../lib/weight'

// Labeled, unit-aware add-food form with a live preview. Replaces the
// placeholder-only inline row that used to live inside the retired inline
// food section.
//
// Slot selection is CONTROLLED by the caller (FoodView, Task 12+), not owned
// here. A prop captured once into useState would make a second per-slot
// "+ Add" a no-op while the form is already open - the caller can union a
// slot in at any time without remounting this component (a remount would eat
// the typed name/weight).
export default function AddFoodForm({
  slots,
  busy,
  weightUnit,
  selectedSlotIds,
  onSelectedSlotIdsChange,
  onCancel,
  onSubmit,
}: {
  slots: readonly FoodSlotResponse[]
  busy: boolean
  weightUnit: WeightUnit
  selectedSlotIds: readonly string[]
  onSelectedSlotIdsChange: (next: string[]) => void
  onCancel: () => void
  onSubmit: (
    input: { name: string; weightGrams: number; quantity: number; slotIds: string[] },
    onSuccess: () => void,
  ) => void
}) {
  const [name, setName] = useState('')
  const [weightGrams, setWeightGrams] = useState(0)
  // ONE. Not the number of slots selected. The app cannot tell five packets
  // from one shared bag, and guessing high silently inflates the pack weight.
  const [quantity, setQuantity] = useState('1')

  const quantityValue = Number(quantity)
  // Mirrors the server's bounds (shared/food.ts) so a rejection is not the
  // first the user hears that a name is too long or a quantity out of range.
  // Weight needs no bound check here: WeightInput clamps to
  // MAX_ITEM_WEIGHT_GRAMS (src/lib/caps.ts), which equals the server's
  // foodWeightSchema max (100000) - the two bounds agree by construction, so
  // weightGrams can never arrive out of range.
  const valid =
    name.trim().length > 0 &&
    name.trim().length <= 128 &&
    Number.isInteger(quantityValue) &&
    quantityValue >= 1 &&
    quantityValue <= 9999

  const preview = addFoodPreview({
    name,
    weightGrams,
    quantity: quantityValue,
    slotIds: selectedSlotIds,
    slots,
    unit: weightUnit,
  })

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onSubmit(
          {
            name: name.trim(),
            weightGrams,
            quantity: quantityValue,
            slotIds: [...selectedSlotIds],
          },
          () => {
            // Success clears the fields THIS form owns so the form is ready
            // for the next item without showing stale data - it never touches
            // selectedSlotIds, which the caller owns. A rejected submit never
            // reaches here (the caller only invokes this after a write
            // succeeds), so typed input survives a cap rejection untouched.
            setName('')
            setWeightGrams(0)
            setQuantity('1')
          },
        )
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-gray-700">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={128}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm font-normal"
          />
        </label>
        <div className="flex flex-col gap-1">
          <label htmlFor="add-food-weight" className="text-xs font-medium text-gray-700">
            Weight
          </label>
          <WeightInput
            grams={weightGrams}
            onChange={setWeightGrams}
            className="w-32"
            inputClassName="w-full rounded border border-gray-300 px-2 py-1.5 text-right text-sm font-normal tabular-nums"
            inputId="add-food-weight"
          />
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
          Qty
          <input
            type="number"
            min={1}
            max={9999}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-16 rounded border border-gray-300 px-2 py-1.5 text-right text-sm font-normal tabular-nums"
          />
        </label>
      </div>
      {/* Direct multi-select. Whole-meal buttons for the common case, per-day
          toggles for the days that differ. No templates, no inheritance. */}
      <FoodSlotPicker slots={slots} selected={selectedSlotIds} onChange={onSelectedSlotIdsChange} />
      {preview && <p className="text-sm text-gray-600">{preview}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !valid}
          className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Add food
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
