import { useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import type { FoodItem } from '../lib/types'
import type { FoodPlanBasis } from '../../shared/food-plans'
import {
  projectFoodGrams,
  roundProjectedGrams,
} from '../../shared/food-projection'
import { formatItemWeight } from '../lib/weight'
import { useWeightUnit } from '../lib/use-weight-unit'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import FormLabel from '../components/FormLabel'
import { NUMERIC_VALUE_TEXT } from '../components/flat-table-styles'
import { formatServingDescriptor } from './serving-format'

// Where an entry is being added, for the dialog heading (e.g. "Day 1 ·
// Breakfast" or "Extras").
export type EntryTargetLabel = string

const BASES: { value: FoodPlanBasis; label: string }[] = [
  { value: 'servings', label: 'Servings' },
  { value: 'packages', label: 'Packages' },
  { value: 'weight', label: 'Weight' },
]

// Parse the amount lexeme. text input (not number) keeps a malformed value as
// NaN so the > 0 guard rejects it rather than silently clamping to blank (same
// discipline as FoodItemDialog).
function parseAmount(s: string): number {
  const t = s.trim()
  if (t === '') return Number.NaN
  return Number(t)
}

// The basis + amount form, shared by the add flow (after a food is picked) and
// the edit flow. Shows a live projected-weight preview so the number the plan
// will gain is visible before saving.
function AmountForm({
  food,
  initialBasis,
  initialAmount,
  submitLabel,
  onSubmit,
  onBack,
  onClose,
  saving,
  saveError,
}: {
  food: FoodItem
  initialBasis: FoodPlanBasis
  initialAmount: string
  submitLabel: string
  onSubmit: (basis: FoodPlanBasis, amount: number) => void
  onBack?: () => void
  onClose: () => void
  saving: boolean
  saveError: string | null
}) {
  const { weightUnit } = useWeightUnit()
  const [basis, setBasis] = useState<FoodPlanBasis>(initialBasis)
  const [amount, setAmount] = useState(initialAmount)
  const [error, setError] = useState<string | null>(null)

  const parsed = parseAmount(amount)
  const preview = useMemo(() => {
    if (!(parsed > 0)) return null
    return projectFoodGrams([
      {
        basis,
        amount: parsed,
        servingWeightGrams: food.servingWeightGrams,
        servingsPerPackage: food.servingsPerPackage,
      },
    ])
  }, [basis, parsed, food.servingWeightGrams, food.servingsPerPackage])

  // A packages entry is allowed even with no package size, but it cannot be
  // weighed - warn so the incomplete flag is not a surprise (design 5.4).
  const packagesUnprojectable =
    basis === 'packages' && food.servingsPerPackage === null

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!(parsed > 0)) {
      setError('Enter an amount greater than zero.')
      return
    }
    setError(null)
    onSubmit(basis, parsed)
  }

  return (
    <form onSubmit={handleSubmit} className="p-6" noValidate>
      <div className="flex items-center gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to food list"
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-gray-900">
            {food.name}
          </h2>
          <p className="truncate text-xs text-gray-500">
            {formatServingDescriptor(food, {
              withWeight: true,
              withCalories: true,
              unit: weightUnit,
            })}
          </p>
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <div className="flex-1">
          <FormLabel htmlFor="entry-basis">Measure by</FormLabel>
          <select
            id="entry-basis"
            value={basis}
            onChange={(e) => setBasis(e.target.value as FoodPlanBasis)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {BASES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <div className="w-28">
          <FormLabel htmlFor="entry-amount">
            {basis === 'weight' ? 'Grams' : 'Amount'}
          </FormLabel>
          <input
            id="entry-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="mt-3 min-h-[1.25rem] text-sm text-gray-600">
        {preview && !preview.incomplete && (
          <span className={NUMERIC_VALUE_TEXT}>
            = {formatItemWeight(roundProjectedGrams(preview.grams), weightUnit)}
          </span>
        )}
        {packagesUnprojectable && (
          <span className="text-amber-600">
            No package size set for this food, so its weight won&apos;t be
            counted until you add one.
          </span>
        )}
      </div>

      {(error ?? saveError) && (
        <p className="mt-2 text-sm text-red-600">{error ?? saveError}</p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Cancel
        </button>
        <PrimaryButton type="submit" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </PrimaryButton>
      </div>
    </form>
  )
}

// Add-entry: pick a food from the library, then set its amount. Two steps in one
// modal so the target heading stays put and Back returns to the list.
export function AddEntryDialog({
  targetLabel,
  foods,
  onAdd,
  onClose,
  saving,
  saveError,
}: {
  targetLabel: EntryTargetLabel
  foods: FoodItem[]
  onAdd: (input: { foodItemId: string; basis: FoodPlanBasis; amount: number }) => void
  onClose: () => void
  saving: boolean
  saveError: string | null
}) {
  const { weightUnit } = useWeightUnit()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<FoodItem | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return foods
    return foods.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.brand?.toLowerCase().includes(q) ?? false),
    )
  }, [foods, search])

  return (
    <Modal
      open
      onClose={onClose}
      title={`Add food to ${targetLabel}`}
      className="w-full max-w-md"
      closeOnBackdropClick={false}
    >
      {picked ? (
        <AmountForm
          food={picked}
          initialBasis="servings"
          initialAmount="1"
          submitLabel="Add to plan"
          onBack={() => setPicked(null)}
          onClose={onClose}
          saving={saving}
          saveError={saveError}
          onSubmit={(basis, amount) =>
            onAdd({ foodItemId: picked.id, basis, amount })
          }
        />
      ) : (
        <div className="flex max-h-[70vh] flex-col p-6">
          <h2 className="text-base font-semibold text-gray-900">
            Add food to {targetLabel}
          </h2>

          <div className="relative mt-4">
            <label className="sr-only" htmlFor="entry-food-search">Search foods to add</label>
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"
            />
            <input
              id="entry-food-search"
              type="search"
              placeholder="Search your food library"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="w-full rounded-lg border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {foods.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">
              Your food library is empty. Add foods on the Foods tab first.
            </p>
          ) : filtered.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">
              No foods match &ldquo;{search}&rdquo;.
            </p>
          ) : (
            <ul className="mt-3 -mx-2 flex-1 overflow-y-auto" aria-label="Food library">
              {filtered.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(f)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-900">
                        {f.name}
                      </span>
                      <span className="block truncate text-xs text-gray-500">
                        {formatServingDescriptor(f, {
                          withWeight: true,
                          withCalories: false,
                          unit: weightUnit,
                        })}
                      </span>
                    </span>
                    <span className={`shrink-0 text-xs text-gray-500 ${NUMERIC_VALUE_TEXT}`}>
                      {f.caloriesPerServing} kcal
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// Edit-entry: change basis/amount of an existing entry. The food is fixed (to
// change the food, remove and re-add), so there is no picker step.
export function EditEntryDialog({
  food,
  basis,
  amount,
  onSave,
  onClose,
  saving,
  saveError,
}: {
  food: FoodItem
  basis: FoodPlanBasis
  amount: number
  onSave: (input: { basis: FoodPlanBasis; amount: number }) => void
  onClose: () => void
  saving: boolean
  saveError: string | null
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${food.name}`}
      className="w-full max-w-md"
      closeOnBackdropClick={false}
    >
      <AmountForm
        food={food}
        initialBasis={basis}
        initialAmount={String(amount)}
        submitLabel="Save"
        onClose={onClose}
        saving={saving}
        saveError={saveError}
        onSubmit={(nextBasis, nextAmount) =>
          onSave({ basis: nextBasis, amount: nextAmount })
        }
      />
    </Modal>
  )
}
