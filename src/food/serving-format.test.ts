import { describe, it, expect } from 'vitest'
import { formatServingDescriptor } from './serving-format'

const withDesc = { serving_description: 'Bar', serving_weight_grams: 60, calories_per_serving: 240 }
const noDesc = { serving_description: null, serving_weight_grams: 60, calories_per_serving: 240 }

describe('formatServingDescriptor', () => {
  // Library row (FoodItemRow): { withWeight: true, withCalories: true }.
  it('library row shows the parenthetical weight and calories', () => {
    expect(formatServingDescriptor(withDesc, { withWeight: true, withCalories: true })).toBe('Bar (60 g) - 240 kcal')
  })

  it('library row falls back to grams when there is no description', () => {
    expect(formatServingDescriptor(noDesc, { withWeight: true, withCalories: true })).toBe('60 g - 240 kcal')
  })

  // Picker row (FoodPicker): { withWeight: false, withCalories: false }.
  it('picker row shows the bare description without weight or calories', () => {
    expect(formatServingDescriptor(withDesc, { withWeight: false, withCalories: false })).toBe('Bar')
  })

  it('picker row falls back to grams when there is no description', () => {
    expect(formatServingDescriptor(noDesc, { withWeight: false, withCalories: false })).toBe('60 g')
  })
})
