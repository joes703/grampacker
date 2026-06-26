import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { ROW_CONTROL_TARGET } from '../components/flat-table-styles'
import { MAX_NAME_LENGTH, MAX_DESC_LENGTH } from '../lib/caps'
import type { FoodItem } from '../lib/types'
import type { FoodItemInput } from '../lib/queries'

type Props = {
  item?: FoodItem
  saving?: boolean
  saveError?: string | null
  onSave: (patch: FoodItemInput) => void
  onClose: () => void
  onDeleteFromInventory?: () => void
  // Optional contextual banner. Used when the dialog is opened from a food-plan
  // entry to warn that this is a library edit (it changes the food everywhere
  // it's used, not just the one entry).
  note?: string
}

// Parse a free-text numeric field into a non-negative number or null
// (blank = unknown, never zero).
function parseOptionalNumber(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// Required positive number (serving weight); null when invalid so save blocks.
function parsePositiveNumber(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

function parseNonNegativeNumber(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function numToField(n: number | null): string {
  return n === null ? '' : String(n)
}

export default function FoodItemDialog({
  item,
  saving = false,
  saveError = null,
  onSave,
  onClose,
  onDeleteFromInventory,
  note,
}: Props) {
  const isEdit = item !== undefined
  const heading = isEdit ? 'Edit food' : 'Add food'

  const [name, setName] = useState(item?.name ?? '')
  const [brand, setBrand] = useState(item?.brand ?? '')
  const [servingDescription, setServingDescription] = useState(item?.serving_description ?? '')
  const [servingWeight, setServingWeight] = useState(numToField(item?.serving_weight_grams ?? null))
  const [calories, setCalories] = useState(numToField(item?.calories_per_serving ?? null))
  const [servingsPerPackage, setServingsPerPackage] = useState(
    numToField(item?.servings_per_package ?? null),
  )
  const [fat, setFat] = useState(numToField(item?.fat_grams ?? null))
  const [satFat, setSatFat] = useState(numToField(item?.saturated_fat_grams ?? null))
  const [carbs, setCarbs] = useState(numToField(item?.carbs_grams ?? null))
  const [fiber, setFiber] = useState(numToField(item?.fiber_grams ?? null))
  const [sugar, setSugar] = useState(numToField(item?.sugar_grams ?? null))
  const [protein, setProtein] = useState(numToField(item?.protein_grams ?? null))
  const [sodium, setSodium] = useState(numToField(item?.sodium_mg ?? null))
  const [potassium, setPotassium] = useState(numToField(item?.potassium_mg ?? null))
  const [notes, setNotes] = useState(item?.notes ?? '')

  const parsedWeight = parsePositiveNumber(servingWeight)
  const parsedCalories = parseNonNegativeNumber(calories)
  const canSave = name.trim().length > 0 && parsedWeight !== null && parsedCalories !== null

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (parsedWeight === null || parsedCalories === null) return
    const patch: FoodItemInput = {
      name: name.trim().slice(0, MAX_NAME_LENGTH),
      brand: brand.trim() || null,
      serving_description: servingDescription.trim() || null,
      serving_weight_grams: parsedWeight,
      calories_per_serving: parsedCalories,
      servings_per_package: parsePositiveNumber(servingsPerPackage),
      fat_grams: parseOptionalNumber(fat),
      saturated_fat_grams: parseOptionalNumber(satFat),
      carbs_grams: parseOptionalNumber(carbs),
      fiber_grams: parseOptionalNumber(fiber),
      sugar_grams: parseOptionalNumber(sugar),
      protein_grams: parseOptionalNumber(protein),
      sodium_mg: parseOptionalNumber(sodium),
      potassium_mg: parseOptionalNumber(potassium),
      notes: notes.trim().slice(0, MAX_DESC_LENGTH) || null,
    }
    onSave(patch)
  }

  const fieldClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none'
  const labelClass = 'block text-sm font-medium text-gray-700'

  function numberField(label: string, value: string, set: (v: string) => void, unit?: string) {
    return (
      <label className="block">
        <span className={labelClass}>
          {label}
          {unit ? <span className="ml-1 text-gray-400">({unit})</span> : null}
        </span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={value}
          onChange={(e) => set(e.target.value)}
          className={`mt-1 ${fieldClass}`}
        />
      </label>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={heading}
      className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-hidden"
      closeOnBackdropClick={false}
    >
      <form onSubmit={handleSubmit} className="flex max-h-[90vh] min-h-0 flex-col">
        <div className="flex items-center justify-between px-6 pt-6 pb-3 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`${ROW_CONTROL_TARGET} text-gray-400 hover:text-gray-600`}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 space-y-4 pb-4">
          {note ? (
            <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              {note}
            </p>
          ) : null}
          <label className="block">
            <span className={labelClass}>Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              className={`mt-1 ${fieldClass}`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Brand</span>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              maxLength={256}
              className={`mt-1 ${fieldClass}`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Serving description</span>
            <input
              value={servingDescription}
              onChange={(e) => setServingDescription(e.target.value)}
              maxLength={256}
              placeholder="e.g. 2 tbsp"
              className={`mt-1 ${fieldClass}`}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            {numberField('Serving weight', servingWeight, setServingWeight, 'g')}
            {numberField('Calories', calories, setCalories, 'per serving')}
          </div>

          {numberField('Servings per package', servingsPerPackage, setServingsPerPackage)}

          <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Nutrition (optional - leave blank if unknown)
          </p>
          <div className="grid grid-cols-2 gap-3">
            {numberField('Fat', fat, setFat, 'g')}
            {numberField('Saturated fat', satFat, setSatFat, 'g')}
            {numberField('Carbs', carbs, setCarbs, 'g')}
            {numberField('Fiber', fiber, setFiber, 'g')}
            {numberField('Sugar', sugar, setSugar, 'g')}
            {numberField('Protein', protein, setProtein, 'g')}
            {numberField('Sodium', sodium, setSodium, 'mg')}
            {numberField('Potassium', potassium, setPotassium, 'mg')}
          </div>

          <label className="block">
            <span className={labelClass}>Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={MAX_DESC_LENGTH}
              rows={2}
              className={`mt-1 ${fieldClass}`}
            />
          </label>

          {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}

          {isEdit && onDeleteFromInventory ? (
            <button
              type="button"
              onClick={onDeleteFromInventory}
              className="text-sm font-medium text-red-600 hover:underline"
            >
              Delete from library
            </button>
          ) : null}
        </div>

        <div
          className="shrink-0 border-t border-gray-100 bg-white px-6 py-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <PrimaryButton type="submit" disabled={saving || !canSave}>
              {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Add food'}
            </PrimaryButton>
          </div>
        </div>
      </form>
    </Modal>
  )
}
