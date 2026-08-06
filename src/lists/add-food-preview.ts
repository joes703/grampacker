import { MEALS, type FoodSlotResponse } from '../../shared/food'
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
    parts.push(input.quantity > 1 ? `${weight} × ${input.quantity}` : weight)
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

  // Check if all selected slots are from a single meal and that meal is fully selected
  const selectedSlots = slots.filter((s) => selected.has(s.id))
  if (selectedSlots.length > 0) {
    const meals = [...new Set(selectedSlots.map((s) => s.meal))]
    if (meals.length === 1) {
      // All selected slots are from the same meal
      const meal = meals[0]!
      const allMealSlots = slots.filter((s) => s.meal === meal)
      if (allMealSlots.every((s) => selected.has(s.id))) {
        // All instances of this meal are selected
        return `every ${meal}`
      }
    }
  }

  // Otherwise, list individual slots sorted by day then meal type
  const sorted = selectedSlots.sort((a, b) => {
    if (a.dayNumber !== b.dayNumber) return a.dayNumber - b.dayNumber
    return MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal)
  })
  const named = sorted
    .slice(0, NAMED_SLOT_LIMIT)
    .map((s) => `Day ${s.dayNumber} ${s.meal}`)
  const more = sorted.length - named.length
  if (more > 0) named.push(`+ ${more} more`)
  return named.join(', ')
}
