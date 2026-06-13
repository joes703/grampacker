import { useState } from 'react'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import type { EntryBasis, FoodItem, FoodPlanEntry } from '../lib/types'
import type { FoodPlanView } from './useFoodPlanDocument'

export type MoveCopyTarget = { kind: 'cell'; dayMealId: string } | { kind: 'extra' }
export type MoveCopyResult = { target: MoveCopyTarget; preserveBasis: EntryBasis | null }

const BASIS_LABEL: Record<EntryBasis, string> = { servings: 'servings', packages: 'packages', weight: 'grams' }

export default function MoveCopyEntryDialog({
  mode, entry, food, view, onConfirm, onClose,
}: {
  mode: 'move' | 'copy'
  entry: FoodPlanEntry
  food: FoodItem
  view: FoodPlanView
  onConfirm: (r: MoveCopyResult) => void
  onClose: () => void
}) {
  const [target, setTarget] = useState<MoveCopyTarget | null>(null)
  const conflict = target ? findExisting(view, food.id, target) : undefined
  const [preserve, setPreserve] = useState<EntryBasis>(entry.basis)

  const needsPreserve = Boolean(conflict) && conflict!.basis !== entry.basis
  const canConfirm = target !== null && !(isSameLocation(entry, target))

  return (
    <Modal open onClose={onClose} title={mode === 'move' ? 'Move food' : 'Copy food'} className="w-[calc(100vw-2rem)] max-w-md max-h-[80vh] overflow-hidden">
      <div className="flex max-h-[80vh] flex-col p-6">
        <h2 className="text-base font-semibold text-gray-900">{mode === 'move' ? 'Move' : 'Copy'} {food.name}</h2>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {view.days.map((dv, i) => (
            <div key={dv.day.id} className="mt-2">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Day {i + 1}</p>
              {dv.cells.map((c) => (
                <label key={c.dayMealId} className="flex items-center gap-2 px-1 py-1 text-sm text-gray-700">
                  <input type="radio" name="dest" checked={target?.kind === 'cell' && target.dayMealId === c.dayMealId}
                    onChange={() => setTarget({ kind: 'cell', dayMealId: c.dayMealId })} />
                  {c.meal.name}
                </label>
              ))}
            </div>
          ))}
          <label className="mt-2 flex items-center gap-2 px-1 py-1 text-sm text-gray-700">
            <input type="radio" name="dest" checked={target?.kind === 'extra'} onChange={() => setTarget({ kind: 'extra' })} />
            Extras
          </label>
        </div>

        {needsPreserve ? (
          <fieldset className="mt-2 rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-xs font-medium text-gray-600">Destination already has this food. Keep the combined total in</legend>
            {[conflict!.basis, entry.basis].map((b) => (
              <label key={b} className="flex items-center gap-2 text-sm text-gray-700">
                <input type="radio" name="preserve" checked={preserve === b} onChange={() => setPreserve(b)} /> {BASIS_LABEL[b]}
              </label>
            ))}
          </fieldset>
        ) : null}

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
          <PrimaryButton type="button" disabled={!canConfirm}
            onClick={() => target && onConfirm({ target, preserveBasis: needsPreserve ? preserve : null })}>
            {mode === 'move' ? 'Move here' : 'Copy here'}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  )
}

function isSameLocation(entry: FoodPlanEntry, target: MoveCopyTarget): boolean {
  if (target.kind === 'extra') return entry.is_extra
  return entry.day_meal_id === target.dayMealId
}
function findExisting(view: FoodPlanView, foodId: string, target: MoveCopyTarget) {
  if (target.kind === 'extra') return view.extras.find((e) => e.food_item_id === foodId)
  const cell = view.days.flatMap((d) => d.cells).find((c) => c.dayMealId === target.dayMealId)
  return cell?.entries.find((e) => e.food_item_id === foodId)
}
