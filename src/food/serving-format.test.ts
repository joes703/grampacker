import { describe, expect, it } from 'vitest'
import type { FoodItem } from '../lib/types'
import {
  calorieDensity,
  carbProteinRatio,
  formatCalorieDensity,
  formatGrams,
  formatMilligrams,
  formatRatio,
  formatServingDescriptor,
} from './serving-format'

function food(over: Partial<FoodItem> = {}): FoodItem {
  return {
    id: 'f1',
    name: 'Ramen',
    brand: null,
    servingDescription: null,
    servingWeightGrams: 85,
    caloriesPerServing: 380,
    servingsPerPackage: null,
    fatGrams: null,
    saturatedFatGrams: null,
    carbsGrams: null,
    fiberGrams: null,
    sugarGrams: null,
    proteinGrams: null,
    sodiumMg: null,
    potassiumMg: null,
    notes: null,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

describe('formatServingDescriptor', () => {
  it('uses the weight when there is no description', () => {
    expect(
      formatServingDescriptor(food({ servingWeightGrams: 43 }), {
        withWeight: true,
        withCalories: false,
        unit: 'g',
      }),
    ).toBe('43 g')
  })

  it('shows description with the weight in parens when withWeight', () => {
    expect(
      formatServingDescriptor(
        food({ servingDescription: '1 block', servingWeightGrams: 85 }),
        { withWeight: true, withCalories: false, unit: 'g' },
      ),
    ).toBe('1 block (85 g)')
  })

  it('appends calories when withCalories', () => {
    expect(
      formatServingDescriptor(
        food({ servingDescription: '1 block', caloriesPerServing: 380 }),
        { withWeight: false, withCalories: true, unit: 'g' },
      ),
    ).toBe('1 block - 380 kcal')
  })

  it('renders oz when the unit is oz', () => {
    // 85 g -> ~3.0 oz
    expect(
      formatServingDescriptor(food({ servingWeightGrams: 85 }), {
        withWeight: true,
        withCalories: false,
        unit: 'oz',
      }),
    ).toBe('3.0 oz')
  })
})

describe('calorieDensity / formatCalorieDensity', () => {
  it('is kcal per gram', () => {
    expect(
      calorieDensity(food({ caloriesPerServing: 380, servingWeightGrams: 85 })),
    ).toBeCloseTo(4.4706, 4)
  })

  it('formats kcal/g to two decimals', () => {
    expect(formatCalorieDensity(4.47, 'g')).toBe('4.47 kcal/g')
  })

  it('formats kcal/oz to one decimal', () => {
    // 4.47 kcal/g * ~28.35 g/oz = ~126.7 kcal/oz
    expect(formatCalorieDensity(4.47, 'oz')).toBe('126.7 kcal/oz')
  })

  it('renders "-" for a null density', () => {
    expect(formatCalorieDensity(null, 'g')).toBe('-')
  })
})

describe('macro formatters treat null (unknown) as "-", never 0', () => {
  it('grams: known one decimal, unknown dash', () => {
    expect(formatGrams(8)).toBe('8.0 g')
    expect(formatGrams(0)).toBe('0.0 g') // a real 0 is not unknown
    expect(formatGrams(null)).toBe('-')
  })

  it('milligrams: known rounded, unknown dash', () => {
    expect(formatMilligrams(1519.6)).toBe('1520 mg')
    expect(formatMilligrams(null)).toBe('-')
  })
})

describe('carbProteinRatio', () => {
  it('is carbs over protein', () => {
    expect(
      carbProteinRatio(food({ carbsGrams: 52, proteinGrams: 8 })),
    ).toBeCloseTo(6.5, 5)
  })

  it('is null when either operand is unknown or protein is zero', () => {
    expect(carbProteinRatio(food({ carbsGrams: 52, proteinGrams: null }))).toBeNull()
    expect(carbProteinRatio(food({ carbsGrams: null, proteinGrams: 8 }))).toBeNull()
    expect(carbProteinRatio(food({ carbsGrams: 52, proteinGrams: 0 }))).toBeNull()
  })

  it('formatRatio renders two decimals or a dash', () => {
    expect(formatRatio(6.5)).toBe('6.50')
    expect(formatRatio(null)).toBe('-')
  })
})
