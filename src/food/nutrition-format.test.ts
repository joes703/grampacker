import { describe, it, expect } from 'vitest'
import {
  formatDailyTargetBand,
  formatMealTargetBand,
  formatPct,
  inputToKcalPerGram,
  kcalPerGramToInput,
} from './nutrition-format'

describe('formatPct', () => {
  it('one decimal, dash for null', () => {
    expect(formatPct(33.33)).toBe('33.3%')
    expect(formatPct(null)).toBe('-')
  })
})

describe('calorie-density unit round-trip', () => {
  it('converts kcal/g to display and back', () => {
    const oz = kcalPerGramToInput(4.5, 'oz')
    expect(inputToKcalPerGram(oz, 'oz')).toBeCloseTo(4.5, 6)
    expect(kcalPerGramToInput(4.5, 'g')).toBe(4.5)
    expect(inputToKcalPerGram(4.5, 'g')).toBe(4.5)
  })
})

describe('target band strings', () => {
  it('keeps fractional gram targets and trims integers', () => {
    expect(formatDailyTargetBand('protein', 'min', 30.5, null, 'g')).toBe('>= 30.5 g')
    expect(formatDailyTargetBand('protein', 'min', 30, null, 'g')).toBe('>= 30 g')
  })
  it('formats calories and sodium with units', () => {
    expect(formatDailyTargetBand('calories', 'range', 2000, 3000, 'g')).toBe('2000 kcal - 3000 kcal')
    expect(formatDailyTargetBand('sodium', 'max', null, 2300, 'g')).toBe('<= 2300 mg')
  })
  it('converts calorie density to the unit', () => {
    expect(formatDailyTargetBand('calorie_density', 'min', 4.5, null, 'oz')).toBe('>= 127.6 kcal/oz')
    expect(formatDailyTargetBand('calorie_density', 'min', 4.5, null, 'g')).toBe('>= 4.50 kcal/g')
  })
  it('formats meal bands (pct, ratio, off)', () => {
    expect(formatMealTargetBand('fat_pct', 'max', null, 30)).toBe('<= 30%')
    expect(formatMealTargetBand('carb_protein_ratio', 'range', 1.5, 3)).toBe('1.50 - 3.00')
    expect(formatMealTargetBand('calories', 'off', null, null)).toBe('')
  })
})
