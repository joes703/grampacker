import { describe, it, expect } from 'vitest'
import { toGrams } from './units'
import { MAX_ITEM_WEIGHT_GRAMS } from '../caps'

describe('toGrams', () => {
  it('passes grams through for empty / g / gram / grams and unknown units', () => {
    // Empty + g/gram/grams take the grams default; a typo'd unit ("kgs")
    // also falls back to grams as the most-tolerant CSV-import behavior.
    expect(toGrams('100', '')).toBe(100)
    expect(toGrams('100', 'g')).toBe(100)
    expect(toGrams('100', 'gram')).toBe(100)
    expect(toGrams('100', 'grams')).toBe(100)
    expect(toGrams('100', 'kgs')).toBe(100)
  })

  it('converts ounce aliases (oz / ounce / ounces)', () => {
    expect(toGrams('3', 'oz')).toBe(85) // 3 * 28.3495 = 85.0485
    expect(toGrams('2.5', 'ounces')).toBe(71) // 70.87375
    expect(toGrams('1', 'ounce')).toBe(28) // 28.3495
  })

  it('converts pound aliases (lb / pound / pounds)', () => {
    expect(toGrams('1', 'lb')).toBe(454) // 453.592
    expect(toGrams('2', 'pounds')).toBe(907) // 907.184
  })

  it('converts kilogram aliases (kg / kilogram / kilograms)', () => {
    expect(toGrams('1.5', 'kg')).toBe(1500)
    expect(toGrams('0.5', 'kilograms')).toBe(500)
  })

  it('is case- and whitespace-insensitive on the unit', () => {
    expect(toGrams('1', ' KG ')).toBe(1000)
    expect(toGrams('1', 'Oz')).toBe(28)
  })

  it('returns 0 for NaN / non-numeric weights', () => {
    expect(toGrams('abc', 'g')).toBe(0)
    expect(toGrams('', 'g')).toBe(0)
  })

  it('returns 0 for negative weights', () => {
    expect(toGrams('-5', 'g')).toBe(0)
    expect(toGrams('-1', 'kg')).toBe(0)
  })

  it('rounds to the nearest gram', () => {
    expect(toGrams('1.4', 'g')).toBe(1)
    expect(toGrams('1.6', 'g')).toBe(2)
  })

  it('clamps to MAX_ITEM_WEIGHT_GRAMS', () => {
    // 101 kg = 101000 g, above the 100000 g cap.
    expect(toGrams('101', 'kg')).toBe(MAX_ITEM_WEIGHT_GRAMS)
    expect(toGrams(String(MAX_ITEM_WEIGHT_GRAMS + 1), 'g')).toBe(MAX_ITEM_WEIGHT_GRAMS)
  })
})
