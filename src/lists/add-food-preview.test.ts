import { describe, expect, it } from 'vitest'
import { addFoodPreview } from './add-food-preview'
import type { FoodSlotResponse } from '../../shared/food'

function slot(id: string, dayNumber: number, meal: FoodSlotResponse['meal']): FoodSlotResponse {
  return { id, dayNumber, meal }
}

const SLOTS = [
  slot('b1', 1, 'breakfast'), slot('b2', 2, 'breakfast'), slot('b3', 3, 'breakfast'),
  slot('l1', 1, 'lunch'), slot('l2', 2, 'lunch'), slot('l3', 3, 'lunch'),
  slot('d1', 1, 'dinner'), slot('d2', 2, 'dinner'), slot('d3', 3, 'dinner'),
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

  // The multiplier is the count you will CARRY, not the number typed. The
  // form creates per-meal items, so three breakfasts is three - previewing
  // "80 g" for a row that lands at 240 g is the under-report 0024 ended.
  it('collapses a fully selected meal', () => {
    expect(
      addFoodPreview({ name: 'Oatmeal', weightGrams: 80, quantity: 1, slotIds: ['b1', 'b2', 'b3'], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Oatmeal · 80 g × 3 · every breakfast')
  })

  it('elides past three named slots', () => {
    expect(
      addFoodPreview({ name: 'Bar', weightGrams: 50, quantity: 1, slotIds: ['b1', 'l1', 'd1', 'l2'], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Bar · 50 g × 4 · Day 1 breakfast, Day 1 lunch, Day 1 dinner, + 1 more')
  })

  it('omits the weight segment at zero grams', () => {
    expect(
      addFoodPreview({ name: 'Mystery', weightGrams: 0, quantity: 1, slotIds: [], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Mystery · any time')
  })

  it('mixes whole-meal collapse with named slots', () => {
    expect(
      addFoodPreview({ name: 'Mix', weightGrams: 80, quantity: 1, slotIds: ['b1', 'b2', 'b3', 'l1'], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Mix · 80 g × 4 · every breakfast, Day 1 lunch')
  })

  it('collapses multiple full meals', () => {
    expect(
      addFoodPreview({ name: 'Lots', weightGrams: 80, quantity: 1, slotIds: ['b1', 'b2', 'b3', 'l1', 'l2', 'l3'], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Lots · 80 g × 6 · every breakfast, every lunch')
  })

  it('multiplies the per-meal count by the meals picked', () => {
    expect(
      addFoodPreview({ name: 'Bars', weightGrams: 50, quantity: 2, slotIds: ['b1', 'b2', 'b3'], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Bars · 50 g × 6 · every breakfast')
  })

  it('shows no multiplier for a single unscheduled unit', () => {
    expect(
      addFoodPreview({ name: 'Bar', weightGrams: 50, quantity: 1, slotIds: [], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Bar · 50 g · any time')
  })
})
