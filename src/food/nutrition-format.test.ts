import { describe, it, expect } from 'vitest'
import {
  formatCalorieDensity, formatPct, formatRatio, formatSodiumDensity,
  kcalPerGramToInput, inputToKcalPerGram, formatDailyTargetBand, formatMealTargetBand,
} from './nutrition-format'

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

describe('derived formatters', () => {
  it('formats pct/ratio/sodium-density and null', () => {
    expect(formatPct(33.33)).toBe('33.3%')
    expect(formatPct(null)).toBe('-')
    expect(formatRatio(2.5)).toBe('2.50')
    expect(formatRatio(null)).toBe('-')
    expect(formatSodiumDensity(1.25)).toBe('1.3 mg/kcal')
    expect(formatSodiumDensity(null)).toBe('-')
  })
})
describe('calorie-density unit round-trip', () => {
  it('converts kcal/g to display and back', () => {
    const oz = kcalPerGramToInput(4.5, 'oz')
    expect(inputToKcalPerGram(oz, 'oz')).toBeCloseTo(4.5, 6)
    expect(kcalPerGramToInput(4.5, 'g')).toBe(4.5)
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
