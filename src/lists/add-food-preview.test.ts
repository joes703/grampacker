import { describe, expect, it } from 'vitest'
import { addFoodPreview } from './add-food-preview'
import type { FoodSlotResponse } from '../../shared/food'

function slot(id: string, dayNumber: number, meal: FoodSlotResponse['meal']): FoodSlotResponse {
  return { id, dayNumber, meal, needed: true }
}

const SLOTS = [
  slot('b1', 1, 'breakfast'), slot('b2', 2, 'breakfast'),
  slot('l1', 1, 'lunch'), slot('l2', 2, 'lunch'),
  slot('d1', 1, 'dinner'), slot('d2', 2, 'dinner'),
]

describe('addFoodPreview', () => {
  it('is null with a blank name', () => {
    expect(addFoodPreview({ name: '  ', weightGrams: 80, quantity: 1, slotIds: [], slots: SLOTS, unit: 'g' })).toBeNull()
  })

  it('assembles name, weight, and a named slot', () => {
    expect(
      addFoodPreview({ name: 'Oatmeal', weightGrams: 80, quantity: 1, slotIds: ['b2'], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Oatmeal · 80 g · Day 2 breakfast')
  })

  it('shows quantity past one', () => {
    expect(
      addFoodPreview({ name: 'Oatmeal', weightGrams: 80, quantity: 2, slotIds: [], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Oatmeal · 80 g × 2 · any time')
  })

  it('collapses a fully selected meal', () => {
    expect(
      addFoodPreview({ name: 'Oatmeal', weightGrams: 80, quantity: 1, slotIds: ['b1', 'b2'], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Oatmeal · 80 g · every breakfast')
  })

  it('elides past three named slots', () => {
    expect(
      addFoodPreview({ name: 'Bar', weightGrams: 50, quantity: 1, slotIds: ['b1', 'l1', 'd1', 'l2'], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Bar · 50 g · Day 1 breakfast, Day 1 lunch, Day 1 dinner, + 1 more')
  })

  it('omits the weight segment at zero grams', () => {
    expect(
      addFoodPreview({ name: 'Mystery', weightGrams: 0, quantity: 1, slotIds: [], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Mystery · any time')
  })
})
