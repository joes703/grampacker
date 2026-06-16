import { useMemo, useState, type FormEvent } from 'react'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { FOOD_PLAN_DAY_CAP } from '../lib/caps'
import { buildFoodPlanStructure, type FoodPlanStructure } from '../lib/food/basis'
import { randomTempId } from '../lib/random-temp-id'

export default function CreateFoodPlanDialog({
  saving = false,
  onCreate,
  onClose,
}: {
  saving?: boolean
  onCreate: (structure: FoodPlanStructure) => void
  onClose: () => void
}) {
  const [days, setDays] = useState('1')
  const [omitted, setOmitted] = useState<Set<string>>(() => new Set())

  const parsedDays = Number(days)
  const dayCount = Number.isInteger(parsedDays) ? parsedDays : 0

  const seedDayCount = Math.min(FOOD_PLAN_DAY_CAP, Math.max(0, dayCount))
  const seed = useMemo(() => buildFoodPlanStructure(seedDayCount, randomTempId), [seedDayCount])

  const plannedMeals = seed.dayMeals.filter((_, index) => !omitted.has(String(index))).length
  const canCreate = dayCount >= 1 && dayCount <= FOOD_PLAN_DAY_CAP && plannedMeals >= 1

  function toggle(cellKey: string) {
    setOmitted((prev) => {
      const next = new Set(prev)
      if (next.has(cellKey)) next.delete(cellKey)
      else next.add(cellKey)
      return next
    })
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canCreate) return
    onCreate({
      meals: seed.meals,
      days: seed.days,
      dayMeals: seed.dayMeals.filter((_, index) => !omitted.has(String(index))),
    })
  }

  return (
    <Modal open onClose={onClose} title="Start a food plan" className="w-[calc(100vw-2rem)] max-w-md max-h-[85vh] overflow-hidden">
      <form onSubmit={submit} className="flex max-h-[85vh] flex-col">
        <div className="px-6 pt-6">
          <h2 className="text-base font-semibold text-gray-900">Start a food plan</h2>
          <p className="mt-1 text-sm text-gray-600">
            This seeds your day and meal sections. Every day starts with all the default meals you
            pick below. Open the schedule grid afterward to remove any meal you won't carry on a
            given day.
          </p>
          <div className="mt-4 max-w-32">
            <label className="block text-sm font-medium text-gray-700">
              Days
              <input
                autoFocus type="number" inputMode="numeric" min={1} max={FOOD_PLAN_DAY_CAP} step={1} value={days}
                onChange={(e) => setDays(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
              />
            </label>
          </div>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-6">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{plannedMeals} planned meals</p>
          <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Day</th>
                  {seed.meals.map((m) => (
                    <th key={m.id} className="px-3 py-1.5 font-medium">{m.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {seed.days.map((d, i) => (
                  <tr key={d.id} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 text-gray-700">Day {i + 1}</td>
                    {seed.meals.map((m, mealIndex) => {
                      const cellKey = String(i * seed.meals.length + mealIndex)
                      return (
                        <td key={m.id} className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            aria-label={`Day ${i + 1} ${m.name}`}
                            checked={!omitted.has(cellKey)}
                            onChange={() => toggle(cellKey)}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            Add or rename meals later from the plan. Emergency or unassigned food goes in Extras, not a day.
          </p>
        </div>

        <div className="shrink-0 border-t border-gray-100 bg-white px-6 py-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
              Cancel
            </button>
            <PrimaryButton type="submit" disabled={saving || !canCreate}>
              {saving ? 'Starting...' : 'Start food plan'}
            </PrimaryButton>
          </div>
        </div>
      </form>
    </Modal>
  )
}
