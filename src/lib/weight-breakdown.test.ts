import { describe, it, expect } from 'vitest'
import { withProjectedFood, type WeightBreakdown } from './weight-breakdown'

const base: WeightBreakdown = {
  catRows: [{ id: 'c', name: 'Cook', grams: 200 }],
  baseGrams: 200, consumableGrams: 100, wornGrams: 50, totalPackGrams: 300,
}

describe('withProjectedFood', () => {
  it('adds projected grams to consumable and pack total only', () => {
    const out = withProjectedFood(base, 150)
    expect(out.consumableGrams).toBe(250)
    expect(out.totalPackGrams).toBe(450)
    expect(out.baseGrams).toBe(200)
    expect(out.wornGrams).toBe(50)
    expect(out.catRows).toEqual(base.catRows)
  })
  it('is a no-op for zero and does not mutate the input', () => {
    const out = withProjectedFood(base, 0)
    expect(out).toEqual(base)
    expect(out).not.toBe(base)
    expect(base.consumableGrams).toBe(100)
  })
})
