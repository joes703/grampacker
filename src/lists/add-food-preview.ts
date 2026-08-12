import { MEALS, foodUnitCount, type FoodSlotResponse } from '../../shared/food'
import { formatItemWeight, type WeightUnit } from '../lib/weight'

const NAMED_SLOT_LIMIT = 3

// The add-form's confirmation-before-commit line. Pure so it is testable
// without rendering; the form derives it every keystroke.
export function addFoodPreview(input: {
  name: string
  weightGrams: number
  quantity: number
  slotIds: readonly string[]
  slots: readonly FoodSlotResponse[]
  unit: WeightUnit
}): string | null {
  const name = input.name.trim()
  if (!name) return null
  const parts = [name]
  if (input.weightGrams > 0) {
    const weight = formatItemWeight(input.weightGrams, input.unit)
    // The count this will actually CARRY, not the number typed. The form
    // creates per-meal items (the server default), so picking five lunches
    // means five - and a preview that said "80 g x 1" while the row landed at
    // 400 g would be the same lie the whole model change exists to end.
    const units = foodUnitCount({
      quantity: input.quantity,
      isPerMeal: true,
      slotIds: input.slotIds,
    })
    parts.push(units > 1 ? `${weight} × ${units}` : weight)
  }
  parts.push(describeSlots(input.slotIds, input.slots))
  return `Adding: ${parts.join(' · ')}`
}

function describeSlots(
  slotIds: readonly string[],
  slots: readonly FoodSlotResponse[],
): string {
  if (slotIds.length === 0) return 'any time'
  const selected = new Set(slotIds)

  // Identify which meals are fully selected, then collect remaining selected slots
  const wholeMeals: string[] = []
  const remainingSelected: FoodSlotResponse[] = []

  for (const meal of MEALS) {
    const mealSlots = slots.filter((s) => s.meal === meal)
    if (mealSlots.length > 0 && mealSlots.every((s) => selected.has(s.id))) {
      // All slots of this meal are selected
      wholeMeals.push(`every ${meal}`)
    } else {
      // Add individual selected slots of this meal to the remaining list
      remainingSelected.push(...mealSlots.filter((s) => selected.has(s.id)))
    }
  }

  // Sort remaining slots chronologically for readability: by dayNumber first, then by meal
  // type order (breakfast -> lunch -> dinner) so users read slots in trip order.
  remainingSelected.sort((a, b) => {
    if (a.dayNumber !== b.dayNumber) return a.dayNumber - b.dayNumber
    return MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal)
  })

  // Build output: whole meals first (in MEALS order), then named slots (first 3), then remainder count
  const namedSlots = remainingSelected
    .slice(0, NAMED_SLOT_LIMIT)
    .map((s) => `Day ${s.dayNumber} ${s.meal}`)
  const parts = [...wholeMeals, ...namedSlots]
  const more = remainingSelected.length - namedSlots.length
  if (more > 0) parts.push(`+ ${more} more`)
  return parts.join(', ')
}
