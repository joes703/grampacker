import { describe, expect, it } from 'vitest'
import { foodItemPatch, foodItemSummary, type FoodItemDraft } from './food-item-form'

function draft(overrides: Partial<FoodItemDraft> = {}): FoodItemDraft {
  return {
    name: 'Fruit bar',
    weightGrams: 30,
    quantity: 2,
    isPerMeal: true,
    slotIds: ['s1', 's2', 's3', 's4'],
    ...overrides,
  }
}

describe('foodItemSummary', () => {
  it('per-meal: carries quantity × meals, weighs the carried total', () => {
    const s = foodItemSummary(draft(), 'g')
    expect(s.unitCount).toBe(8)
    expect(s.weightLabel).toBe('240 g')
    expect(s.note).toBe('2 per meal × 4 meals')
  })

  it('per-meal unscheduled counts one meal’s worth, and says so', () => {
    const s = foodItemSummary(draft({ slotIds: [] }), 'g')
    expect(s.unitCount).toBe(2)
    expect(s.note).toBe("not scheduled yet — counted as one meal's worth")
  })

  it('one container ignores the schedule in the count', () => {
    const s = foodItemSummary(draft({ isPerMeal: false, quantity: 1, weightGrams: 350 }), 'g')
    expect(s.unitCount).toBe(1)
    expect(s.weightLabel).toBe('350 g')
    expect(s.note).toBe('one container across 4 meals')
  })

  it('one container with a count over one says the total', () => {
    const s = foodItemSummary(
      draft({ isPerMeal: false, quantity: 2, slotIds: ['s1'] }),
      'g',
    )
    expect(s.unitCount).toBe(2)
    expect(s.note).toBe('2 total across 1 meal')
  })

  it('one container unscheduled', () => {
    const s = foodItemSummary(draft({ isPerMeal: false, quantity: 1, slotIds: [] }), 'g')
    expect(s.note).toBe('one container, not scheduled yet')
  })

  it('zero weight omits the weight label but keeps the count', () => {
    const s = foodItemSummary(draft({ weightGrams: 0 }), 'g')
    expect(s.unitCount).toBe(8)
    expect(s.weightLabel).toBeNull()
  })
})

describe('foodItemPatch', () => {
  const base = draft()

  it('returns null when nothing changed', () => {
    expect(foodItemPatch(base, draft())).toBeNull()
  })

  it('a whitespace-only name change is no change', () => {
    expect(foodItemPatch(base, draft({ name: '  Fruit bar  ' }))).toBeNull()
  })

  it('reordered slot ids are no change', () => {
    expect(foodItemPatch(base, draft({ slotIds: ['s4', 's3', 's2', 's1'] }))).toBeNull()
  })

  it('sends only the fields that changed, with the name trimmed', () => {
    expect(foodItemPatch(base, draft({ name: ' Fruit bars ', quantity: 3 }))).toEqual({
      name: 'Fruit bars',
      quantity: 3,
    })
  })

  // false, 0 and [] are real writes, not "unset" - the server's nonEmptyPatch
  // counts defined values, so these must survive the diff.
  it('preserves explicit false, zero weight, and empty slotIds', () => {
    expect(
      foodItemPatch(base, draft({ isPerMeal: false, weightGrams: 0, slotIds: [] })),
    ).toEqual({ isPerMeal: false, weightGrams: 0, slotIds: [] })
  })

  it('clearing every meal produces slotIds: [] (unschedule), not an omission', () => {
    const patch = foodItemPatch(base, draft({ slotIds: [] }))
    expect(patch).toEqual({ slotIds: [] })
  })
})
