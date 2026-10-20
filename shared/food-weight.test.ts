import { describe, expect, it } from 'vitest'
import { createFoodItemRequestSchema, updateFoodItemRequestSchema } from './food'

// Food weight carries the same one-decimal bound as gear weight
// (shared/gear.ts weightGramsSchema): the UI renders tenths, so everything
// storable is displayable, and a rejected value is a real signal rather than
// silent rounding. Values already stored with more decimals stay readable -
// the response schema is a plain number - so the bound gates new writes only.
describe('food weightGrams', () => {
  const create = (weightGrams: number) =>
    createFoodItemRequestSchema.safeParse({
      name: 'Ramen',
      weightGrams,
      quantity: 1,
      slotIds: [],
    })

  it.each([0, 85.5, 100000])('create accepts %s', (v) => {
    expect(create(v).success).toBe(true)
  })

  it.each([12.34, 0.05, -0.1, 100000.1])('create rejects %s', (v) => {
    expect(create(v).success).toBe(false)
  })

  it('update carries the same bound', () => {
    expect(
      updateFoodItemRequestSchema.safeParse({ weightGrams: 85.5 }).success,
    ).toBe(true)
    expect(
      updateFoodItemRequestSchema.safeParse({ weightGrams: 12.34 }).success,
    ).toBe(false)
  })
})
