import { describe, it, expect } from 'vitest'
import { formatCalorieDensity } from './nutrition-format'

describe('formatCalorieDensity', () => {
  it('formats canonical kcal/g to two decimals', () => {
    expect(formatCalorieDensity(2, 'g')).toBe('2.00 kcal/g')
  })
  it('converts kcal/g to kcal/oz (one decimal)', () => {
    // 2 kcal/g * 28.3495 g/oz = 56.699 -> 56.7 kcal/oz
    expect(formatCalorieDensity(2, 'oz')).toBe('56.7 kcal/oz')
  })
  it('renders a dash for null in either unit', () => {
    expect(formatCalorieDensity(null, 'g')).toBe('-')
    expect(formatCalorieDensity(null, 'oz')).toBe('-')
  })
})
