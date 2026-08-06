import {
  FLAT_TABLE_META_TEXT,
} from '../components/flat-table-styles'
import { MEALS, type FoodSlotResponse, type Meal } from '../../shared/food'

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast',
  // Joe's definition: everything between breakfast and dinner. Not a sit-down.
  lunch: 'Lunch',
  dinner: 'Dinner',
}

function FoodSlotPicker({
  slots,
  selected,
  onChange,
}: {
  slots: readonly FoodSlotResponse[]
  selected: readonly string[]
  onChange: (next: string[]) => void
}) {
  const toggleMeal = (meal: Meal) => {
    const ids = slots.filter((slot) => slot.meal === meal).map((slot) => slot.id)
    const allOn = ids.every((id) => selected.includes(id))
    onChange(
      allOn
        ? selected.filter((id) => !ids.includes(id))
        : [...new Set([...selected, ...ids])],
    )
  }
  const days = [...new Set(slots.map((slot) => slot.dayNumber))].sort((a, b) => a - b)

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {MEALS.map((meal) => {
          const ids = slots.filter((slot) => slot.meal === meal).map((slot) => slot.id)
          if (ids.length === 0) return null
          const allOn = ids.every((id) => selected.includes(id))
          return (
            <button
              key={meal}
              type="button"
              aria-pressed={allOn}
              onClick={() => toggleMeal(meal)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                allOn
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Every {MEAL_LABELS[meal].toLowerCase()}
            </button>
          )
        })}
      </div>
      {days.length > 0 && (
        <div className="rounded border border-gray-200">
          {days.map((day) => (
            <div key={day} className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
              <span className={`w-12 shrink-0 ${FLAT_TABLE_META_TEXT}`}>Day {day}</span>
              {MEALS.map((meal) => {
                const slot = slots.find((s) => s.dayNumber === day && s.meal === meal)
                if (!slot) return null
                const on = selected.includes(slot.id)
                return (
                  <button
                    key={slot.id}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${MEAL_LABELS[meal]} day ${day}`}
                    onClick={() =>
                      onChange(
                        on
                          ? selected.filter((id) => id !== slot.id)
                          : [...selected, slot.id],
                      )
                    }
                    className={`min-h-9 rounded-full border px-3 text-sm font-medium ${
                      on
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {MEAL_LABELS[meal]}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default FoodSlotPicker
