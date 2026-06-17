import { useState, type FormEvent } from 'react'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import type { EntryBasis, FoodItem, FoodPlanEntry } from '../lib/types'
import { effectiveServings } from '../lib/food/basis'

export type EntryAmountResult = { basis: EntryBasis; amount: number; preserveBasis: EntryBasis | null; alsoDayMealIds: string[] }
export type EntryAmountAlsoDay = { id: string; dayMealId: string | null; label: string; omitted?: boolean }

function availableBases(food: FoodItem): EntryBasis[] {
  const bases: EntryBasis[] = ['servings', 'weight']
  if (food.servings_per_package) bases.splice(1, 0, 'packages')
  return bases
}
const BASIS_LABEL: Record<EntryBasis, string> = { servings: 'Servings', packages: 'Packages', weight: 'Weight (g)' }

function formatDerivedNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

export default function EntryAmountDialog({
  food, existing, initial, alsoDays, saving = false, onSave, onClose,
}: {
  food: FoodItem
  existing?: FoodPlanEntry
  initial?: { basis: EntryBasis; amount: number }
  alsoDays?: EntryAmountAlsoDay[]
  saving?: boolean
  onSave: (result: EntryAmountResult) => void
  onClose: () => void
}) {
  const bases = availableBases(food)
  const [basis, setBasis] = useState<EntryBasis>(initial?.basis ?? bases[0] ?? 'servings')
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '1')
  const [preserve, setPreserve] = useState<EntryBasis>(existing?.basis ?? basis)
  const [alsoChecked, setAlsoChecked] = useState<Set<string>>(() => new Set())

  const parsed = Number(amount)
  const canSave = Number.isFinite(parsed) && parsed > 0
  const isMergeConflict = Boolean(existing) && existing!.basis !== basis
  let derived: { servings: number; weightG: number; kcal: number } | null = null
  if (canSave) {
    try {
      const servings = effectiveServings({ basis, amount: parsed }, food)
      derived = {
        servings,
        weightG: servings * food.serving_weight_grams,
        kcal: servings * food.calories_per_serving,
      }
    } catch {
      derived = null
    }
  }

  function selectAllAlsoDays() {
    setAlsoChecked(new Set(alsoDays?.flatMap((d) => (!d.omitted && d.dayMealId ? [d.dayMealId] : [])) ?? []))
  }

  function clearAlsoDays() {
    setAlsoChecked(new Set())
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    onSave({
      basis,
      amount: parsed,
      preserveBasis: isMergeConflict ? preserve : null,
      alsoDayMealIds: alsoDays ? [...alsoChecked] : [],
    })
  }

  return (
    <Modal open onClose={onClose} title={food.name} className="w-[calc(100vw-2rem)] max-w-sm">
      <form onSubmit={submit} className="space-y-4 p-6">
        <h2 className="text-base font-semibold text-gray-900">{food.name}</h2>
        {existing ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This already has {existing.amount} {BASIS_LABEL[existing.basis].toLowerCase()} here. Your amount will be added to it.
          </p>
        ) : null}
        <label className="block text-sm font-medium text-gray-700">
          {existing ? 'Add measured by' : 'Measure by'}
          <select value={basis} onChange={(e) => setBasis(e.target.value as EntryBasis)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none">
            {bases.map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700">
          {existing ? 'Amount to add' : 'Amount'}
          <input autoFocus type="number" inputMode="decimal" min={0} step="any" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none" />
        </label>
        {derived ? (
          <div className="space-y-1 text-xs">
            <p className="text-gray-500 tabular-nums">
              = {formatDerivedNumber(derived.servings)} servings - {Math.round(derived.weightG)} g - {Math.round(derived.kcal)} kcal
            </p>
            <p className="text-gray-400">
              Entered as {BASIS_LABEL[basis].toLowerCase()} - that basis is kept; the rest is derived from the library item.
            </p>
          </div>
        ) : null}

        {alsoDays && alsoDays.length > 0 ? (
          <fieldset className="rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-xs font-medium text-gray-600">Also add to</legend>
            <div className="mb-2 flex justify-end gap-2 text-xs">
              <button type="button" onClick={selectAllAlsoDays} className="font-medium text-emerald-700 hover:underline">
                All days
              </button>
              <button type="button" onClick={clearAlsoDays} className="font-medium text-gray-500 hover:underline">
                Clear
              </button>
            </div>
            <div className="mt-1 space-y-1">
              {alsoDays.map((d) => {
                const disabled = d.omitted || d.dayMealId === null
                return (
                  <label
                    key={d.id}
                    className={`flex items-center gap-2 text-sm ${disabled ? 'cursor-not-allowed text-gray-400 opacity-60' : 'text-gray-700'}`}
                  >
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={d.dayMealId !== null && alsoChecked.has(d.dayMealId)}
                      onChange={(e) => setAlsoChecked((prev) => {
                        const next = new Set(prev)
                        if (d.dayMealId === null) return next
                        if (e.target.checked) next.add(d.dayMealId)
                        else next.delete(d.dayMealId)
                        return next
                      })}
                    />
                    {d.label}
                    {disabled ? <span className="text-xs">omitted from this day</span> : null}
                  </label>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Where the food already exists, compatible quantities merge.
            </p>
          </fieldset>
        ) : null}

        {isMergeConflict ? (
          <fieldset className="rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-xs font-medium text-gray-600">Keep the combined total in</legend>
            <div className="mt-1 space-y-1">
              {[existing!.basis, basis].map((b) => (
                <label key={b} className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="radio" name="preserve" checked={preserve === b} onChange={() => setPreserve(b)} />
                  {BASIS_LABEL[b]}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
            Cancel
          </button>
          <PrimaryButton type="submit" disabled={saving || !canSave}>{saving ? 'Saving...' : 'Save'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  )
}
