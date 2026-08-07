import {
  FLAT_TABLE_META_TEXT,
  TOGGLE_CHIP,
  TOGGLE_CHIP_OFF,
  TOGGLE_CHIP_ON,
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
              className={`${TOGGLE_CHIP} ${allOn ? TOGGLE_CHIP_ON : TOGGLE_CHIP_OFF}`}
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
                    className={`${TOGGLE_CHIP} ${on ? TOGGLE_CHIP_ON : TOGGLE_CHIP_OFF}`}
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
