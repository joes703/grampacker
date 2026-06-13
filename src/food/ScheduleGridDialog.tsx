import Modal from '../components/Modal'
import type { FoodPlanView } from './useFoodPlanDocument'

export type ScheduleToggle = { dayId: string; mealId: string; on: boolean; dayMealId?: string }

export default function ScheduleGridDialog({
  view, onToggle, onClose,
}: {
  view: FoodPlanView
  onToggle: (t: ScheduleToggle) => void
  onClose: () => void
}) {
  // dayMealId lookup for scheduled (day, meal) pairs (needed to omit/delete).
  const dayMealIdFor = new Map<string, string>() // `${dayId}:${mealId}` -> dayMealId
  for (const dv of view.days) {
    for (const c of dv.cells) dayMealIdFor.set(`${dv.day.id}:${c.meal.id}`, c.dayMealId)
  }

  return (
    <Modal open onClose={onClose} title="Edit schedule" className="w-[calc(100vw-2rem)] max-w-2xl max-h-[85vh] overflow-hidden">
      <div className="flex max-h-[85vh] flex-col p-6">
        <h2 className="text-base font-semibold text-gray-900">Edit schedule</h2>
        <p className="mt-1 text-sm text-gray-600">Check a meal to schedule it on a day; uncheck to omit it.</p>
        <div className="mt-4 min-h-0 flex-1 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-2 font-medium">Day</th>
                {view.meals.map((m) => (
                  <th key={m.id} className="px-3 py-2 font-medium">{m.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.days.map((dv, i) => (
                <tr key={dv.day.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-700">
                    Day {i + 1} <span className="ml-1 text-xs uppercase tracking-wide text-gray-400">{dv.dayType}</span>
                  </td>
                  {view.meals.map((m) => {
                    const on = dv.scheduledMealIds.has(m.id)
                    const dayMealId = dayMealIdFor.get(`${dv.day.id}:${m.id}`)
                    return (
                      <td key={m.id} className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Day ${i + 1} ${m.name}`}
                          checked={on}
                          onChange={() => onToggle({ dayId: dv.day.id, mealId: m.id, on: !on, dayMealId })}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Done</button>
        </div>
      </div>
    </Modal>
  )
}
