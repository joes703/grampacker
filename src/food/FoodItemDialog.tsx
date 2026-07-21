import { useState, type FormEvent } from 'react'
import { Trash2, X } from 'lucide-react'
import {
  createFoodItemRequestSchema,
  type CreateFoodItemRequest,
} from '../../shared/food'
import type { FoodItem } from '../lib/types'
import { MAX_NAME_LENGTH, MAX_DESC_LENGTH } from '../lib/caps'
import FormLabel from '../components/FormLabel'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { ROW_CONTROL_TARGET } from '../components/flat-table-styles'

// The validated payload the dialog hands back. It is exactly the create
// request shape (every field present); the edit path sends it as a full
// PATCH, matching how GearItemDialog hands back a full GearPatch.
export type FoodPatch = CreateFoodItemRequest

type Props = {
  item?: FoodItem
  onSave: (patch: FoodPatch) => void
  onClose: () => void
  saving?: boolean
  // Save-time error surfaced from the parent (e.g. the cap 422). Rendered
  // inline so the user sees it without a toast and keeps their edits.
  saveError?: string | null
  // Mobile-only Delete from library action (edit mode). Desktop reaches
  // delete via the row kebab.
  onDeleteFromLibrary?: () => void
}

// Tri-state numeric parse: blank -> null (unknown), otherwise Number(). A
// non-numeric string yields NaN, which the shared zod schema rejects - so
// "invalid" never silently collapses to "unknown" (null). That distinction
// is load-bearing: a null servingsPerPackage is the incomplete-projection
// signal (design 5.4), so a fat-fingered "-1" (or "abc") must be a rejected
// input, not an accidental "unknown".
//
// The inputs are type="text" (not type="number") ON PURPOSE: a number input
// SANITIZES malformed text to "" before onChange sees it, which would turn
// "abc" back into blank -> null and silently re-introduce the very conflation
// this parser exists to prevent (Codex finding). text + inputMode="decimal"
// keeps the raw lexeme, so Number("abc") is NaN and the schema rejects it.
function parseOptional(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  return Number(t)
}

// Required numeric parse: blank -> NaN so the schema rejects it (the field
// is not nullable). NaN also comes from a non-numeric string.
function parseRequired(s: string): number {
  const t = s.trim()
  if (t === '') return Number.NaN
  return Number(t)
}

function numToField(n: number | null): string {
  return n === null ? '' : String(n)
}

export default function FoodItemDialog({
  item,
  onSave,
  onClose,
  saving = false,
  saveError = null,
  onDeleteFromLibrary,
}: Props) {
  const [name, setName] = useState(item?.name ?? '')
  const [brand, setBrand] = useState(item?.brand ?? '')
  const [servingDescription, setServingDescription] = useState(
    item?.servingDescription ?? '',
  )
  const [servingWeight, setServingWeight] = useState(
    numToField(item?.servingWeightGrams ?? null),
  )
  const [calories, setCalories] = useState(
    numToField(item?.caloriesPerServing ?? null),
  )
  const [servingsPerPackage, setServingsPerPackage] = useState(
    numToField(item?.servingsPerPackage ?? null),
  )
  const [fat, setFat] = useState(numToField(item?.fatGrams ?? null))
  const [saturatedFat, setSaturatedFat] = useState(
    numToField(item?.saturatedFatGrams ?? null),
  )
  const [carbs, setCarbs] = useState(numToField(item?.carbsGrams ?? null))
  const [fiber, setFiber] = useState(numToField(item?.fiberGrams ?? null))
  const [sugar, setSugar] = useState(numToField(item?.sugarGrams ?? null))
  const [protein, setProtein] = useState(numToField(item?.proteinGrams ?? null))
  const [sodium, setSodium] = useState(numToField(item?.sodiumMg ?? null))
  const [potassium, setPotassium] = useState(
    numToField(item?.potassiumMg ?? null),
  )
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  const isEdit = Boolean(item)
  const heading = isEdit ? 'Edit food' : 'New food'

  // Blank text -> null (unknown), never an empty string. Matches the server
  // schema, which rejects '' and expects null to clear.
  const textOrNull = (s: string): string | null => s.trim() || null

  // The candidate payload the shared schema validates. Built the same way for
  // both the live canSave check and submit, so what disables Save is exactly
  // what would be rejected.
  function buildCandidate() {
    return {
      name: name.trim(),
      brand: textOrNull(brand),
      servingDescription: textOrNull(servingDescription),
      servingWeightGrams: parseRequired(servingWeight),
      caloriesPerServing: parseRequired(calories),
      servingsPerPackage: parseOptional(servingsPerPackage),
      fatGrams: parseOptional(fat),
      saturatedFatGrams: parseOptional(saturatedFat),
      carbsGrams: parseOptional(carbs),
      fiberGrams: parseOptional(fiber),
      sugarGrams: parseOptional(sugar),
      proteinGrams: parseOptional(protein),
      sodiumMg: parseOptional(sodium),
      potassiumMg: parseOptional(potassium),
      notes: textOrNull(notes),
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // The shared schema is the single source of truth for the bounds. Run
    // it BEFORE the optimistic mutation so an invalid value is caught here,
    // not flashed-and-rolled-back after the server rejects it (AGENTS.md).
    const parsed = createFoodItemRequestSchema.safeParse(buildCandidate())
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      setError(
        first
          ? `${first.path.join('.') || 'Form'}: ${first.message}`
          : 'Please check the highlighted fields.',
      )
      return
    }
    setError(null)
    onSave(parsed.data)
  }

  // Save is disabled unless the whole payload passes the shared schema, so an
  // invalid value (negative, malformed, too precise, over-bounds, or a
  // missing required field) disables Save rather than erroring only on click
  // (Codex finding).
  const canSave = createFoodItemRequestSchema.safeParse(buildCandidate()).success

  const numberField = (
    id: string,
    label: string,
    unit: string | null,
    value: string,
    onChange: (v: string) => void,
    required = false,
  ) => (
    <div className="min-w-0">
      <FormLabel htmlFor={id}>
        {label}
        {unit && <span className="ml-1 text-gray-400">({unit})</span>}
      </FormLabel>
      <input
        id={id}
        // text (not number) so a malformed lexeme survives to Number() -> NaN
        // and is rejected, rather than being sanitized to "" (-> null). See
        // parseOptional's note.
        type="text"
        inputMode="decimal"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )

  return (
    <Modal
      open
      onClose={onClose}
      title={heading}
      className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-hidden"
      closeOnBackdropClick={false}
    >
      <form
        onSubmit={handleSubmit}
        // noValidate: the native `required`/`min` are inert here on purpose
        // (AGENTS.md), so validation is the manual gate + the shared schema.
        noValidate
        className="flex max-h-[90vh] min-h-0 flex-col"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-3 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`${ROW_CONTROL_TARGET} shrink-0 text-gray-500 hover:text-gray-600`}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 space-y-4">
          <div>
            <FormLabel htmlFor="fi-name">Name</FormLabel>
            <input
              id="fi-name"
              type="text"
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <FormLabel htmlFor="fi-brand">Brand</FormLabel>
            <input
              id="fi-brand"
              type="text"
              maxLength={MAX_NAME_LENGTH}
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <FormLabel htmlFor="fi-serving">Serving description</FormLabel>
            <input
              id="fi-serving"
              type="text"
              maxLength={MAX_NAME_LENGTH}
              placeholder="e.g. 2 tbsp"
              value={servingDescription}
              onChange={(e) => setServingDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            {numberField(
              'fi-weight',
              'Serving weight',
              'g',
              servingWeight,
              setServingWeight,
              true,
            )}
            {numberField(
              'fi-cal',
              'Calories',
              'per serving',
              calories,
              setCalories,
              true,
            )}
          </div>
          {numberField(
            'fi-spp',
            'Servings per package',
            null,
            servingsPerPackage,
            setServingsPerPackage,
          )}

          <div className="border-t border-gray-200 pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Nutrition (optional - leave blank if unknown)
            </p>
            <div className="grid grid-cols-2 gap-4">
              {numberField('fi-fat', 'Fat', 'g', fat, setFat)}
              {numberField(
                'fi-satfat',
                'Saturated fat',
                'g',
                saturatedFat,
                setSaturatedFat,
              )}
              {numberField('fi-carbs', 'Carbs', 'g', carbs, setCarbs)}
              {numberField('fi-fiber', 'Fiber', 'g', fiber, setFiber)}
              {numberField('fi-sugar', 'Sugar', 'g', sugar, setSugar)}
              {numberField('fi-protein', 'Protein', 'g', protein, setProtein)}
              {numberField('fi-sodium', 'Sodium', 'mg', sodium, setSodium)}
              {numberField(
                'fi-potassium',
                'Potassium',
                'mg',
                potassium,
                setPotassium,
              )}
            </div>
          </div>

          <div>
            <FormLabel htmlFor="fi-notes">Notes</FormLabel>
            <textarea
              id="fi-notes"
              maxLength={MAX_DESC_LENGTH}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {onDeleteFromLibrary && (
            <div className="lg:hidden border-t border-gray-200 pt-4">
              <button
                type="button"
                onClick={onDeleteFromLibrary}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700"
              >
                <Trash2 size={14} />
                Delete from library
              </button>
            </div>
          )}

          {(error || saveError) && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {error ?? saveError}
            </div>
          )}

          <div className="h-2" aria-hidden="true" />
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
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add food'}
            </PrimaryButton>
          </div>
        </div>
      </form>
    </Modal>
  )
}
