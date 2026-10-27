import { Fragment } from 'react'
import { FLAT_TABLE_META_TEXT } from '../components/flat-table-styles'
import { MEALS, type FoodSlotResponse, type Meal } from '../../shared/food'

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast',
  // Joe's definition: everything between breakfast and dinner. Not a sit-down.
  lunch: 'Lunch',
  dinner: 'Dinner',
}

const CHECKBOX = 'h-4 w-4 rounded border-gray-300 text-blue-600'
// The whole cell is the target: 40px touch floor below lg, the 28px pointer
// tier at lg (docs/ui-density.md; tuning one tier must not move the other).
const CELL = 'flex min-h-10 lg:min-h-7 cursor-pointer items-center justify-center'

// The food editor's schedule picker: days down, meals across, one native
// checkbox per slot, plus an "Every day" row of per-meal check-alls. A
// 30-day trip is a column scan here, not ninety separate chips.
export default function FoodMealGrid({
  slots,
  selected,
  onChange,
}: {
  slots: readonly FoodSlotResponse[]
  /** Must already be filtered to ids present in `slots` (the dialog's
   *  live-slot boundary); a stale id here would undercount a column's
   *  "all selected" state. */
  selected: readonly string[]
  onChange: (next: string[]) => void
}) {
  const selectedSet = new Set(selected)
  const days = [...new Set(slots.map((slot) => slot.dayNumber))].sort((a, b) => a - b)
  const mealIds = (meal: Meal) =>
    slots.filter((slot) => slot.meal === meal).map((slot) => slot.id)

  function toggleMeal(meal: Meal) {
    const ids = mealIds(meal)
    const allOn = ids.length > 0 && ids.every((id) => selectedSet.has(id))
    onChange(
      allOn
        ? selected.filter((id) => !ids.includes(id))
        : [...new Set([...selected, ...ids])],
    )
  }

  function toggleSlot(id: string) {
    onChange(
      selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id],
    )
  }

  return (
    <div className="w-fit rounded-lg border border-gray-200 px-3 py-2">
      <div className="grid grid-cols-[3.25rem_repeat(3,3.5rem)] items-center gap-x-1">
        <span aria-hidden="true" />
        {MEALS.map((meal) => (
          <span key={meal} className="px-1 text-center text-xs font-semibold text-gray-700">
            {MEAL_LABELS[meal]}
          </span>
        ))}

        <span className={`${FLAT_TABLE_META_TEXT} text-gray-600`}>Every day</span>
        {MEALS.map((meal) => {
          const ids = mealIds(meal)
          const allOn = ids.length > 0 && ids.every((id) => selectedSet.has(id))
          return (
            <label key={meal} className={CELL}>
              <input
                type="checkbox"
                checked={allOn}
                onChange={() => toggleMeal(meal)}
                aria-label={`Every ${MEAL_LABELS[meal].toLowerCase()}`}
                className={CHECKBOX}
              />
            </label>
          )
        })}

        <span aria-hidden="true" className="col-span-full my-1 h-px bg-gray-100" />

        {days.map((day) => (
          <Fragment key={day}>
            <span className={`${FLAT_TABLE_META_TEXT} text-gray-600`}>Day {day}</span>
            {MEALS.map((meal) => {
              const slot = slots.find((s) => s.dayNumber === day && s.meal === meal)
              if (!slot) return <span key={meal} aria-hidden="true" />
              return (
                <label key={slot.id} className={CELL}>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(slot.id)}
                    onChange={() => toggleSlot(slot.id)}
                    aria-label={`${MEAL_LABELS[meal]} day ${day}`}
                    className={CHECKBOX}
                  />
                </label>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
